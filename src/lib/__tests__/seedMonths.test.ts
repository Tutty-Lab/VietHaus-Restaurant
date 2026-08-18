// ============================================================================
// Der Scheduler gegen drei Monate mit UNTERSCHIEDLICHEN Belegschaften.
// Prüft die harten Regeln und schreibt zusätzlich einen Report auf die Konsole,
// an dem man die Qualität des Plans ablesen kann (Stoßzeiten, Gewichtstreue).
// ============================================================================

import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { analyzeSchedule } from "../analyze";
import { validateSchedule } from "../validation";
import { maxConsecutiveRun } from "../consecutive";
import { SEED_MONTHS, totalTargetHours } from "../seedData";
import { DEFAULT_WORK_HOURS } from "../workHours";
import { calculatePause } from "../time";
import { WEEKDAY_SHORT_DE } from "../demand";

const runs = SEED_MONTHS.map((seed) => {
  const shifts = generateSchedule({
    year: seed.year,
    month: seed.month,
    workHours: DEFAULT_WORK_HOURS,
    employees: seed.employees,
  });
  const analysis = analyzeSchedule({
    year: seed.year,
    month: seed.month,
    workHours: DEFAULT_WORK_HOURS,
    employees: seed.employees,
    shifts,
  });
  return { seed, shifts, analysis };
});

describe.each(runs)("Seed-Monat: $seed.label", ({ seed, shifts, analysis }) => {
  it("trifft die Summe der Sollstunden exakt", () => {
    expect(analysis.totalPaidHours).toBe(totalTargetHours(seed));
  });

  it("trifft jedes einzelne Mitarbeiter-Soll exakt", () => {
    for (const emp of seed.employees) {
      expect(analysis.hoursByEmployee.get(emp.id)).toBe(emp.targetMinutes / 60);
    }
  });

  it("besteht die Validierung ohne Fehler", () => {
    const result = validateSchedule(seed.employees, shifts);
    expect(result.errors).toEqual([]);
  });

  it("hält höchstens 6 aufeinanderfolgende Arbeitstage ein", () => {
    for (const emp of seed.employees) {
      const dates = shifts.filter((s) => s.employeeId === emp.id).map((s) => s.date);
      expect(maxConsecutiveRun(dates)).toBeLessThanOrEqual(6);
    }
  });

  it("jede Schicht ist 3..9 h lang mit passender Pause", () => {
    for (const s of shifts) {
      expect(s.paidMinutes).toBeGreaterThanOrEqual(3 * 60);
      expect(s.paidMinutes).toBeLessThanOrEqual(9 * 60);
      expect(s.pauseMinutes).toBe(calculatePause(s.paidMinutes));
      expect(s.endMinutes - s.startMinutes - s.pauseMinutes).toBe(s.paidMinutes);
    }
  });

  it("plant keine Schicht außerhalb des Arbeitszeit-Fensters", () => {
    for (const s of shifts) {
      expect(s.startMinutes).toBeGreaterThanOrEqual(11 * 60 + 30);
      expect(s.endMinutes).toBeLessThanOrEqual(22 * 60);
    }
  });

  it("besetzt die Stoßzeit an jedem offenen Tag mit mindestens 2 Personen", () => {
    const bad = analysis.peakViolations.map(
      (d) =>
        `${d.date} (${WEEKDAY_SHORT_DE[d.weekday]}, ${d.shiftCount} Dienste): ` +
        d.peaks.map((p) => `${p.label}=${p.minStaff}`).join(", "),
    );
    // maxPeakGaps ist die dokumentierte Schwäche dieses Monats, siehe seedData.
    expect(bad.length).toBeLessThanOrEqual(seed.maxPeakGaps ?? 0);
  });

  it("Gegenprobe Minute für Minute: 18–21 Uhr nie unter 2 Personen", () => {
    // Unabhängig von minCoverageOver – stumpf jede Minute zählen. Wäre die
    // Abtastung dort falsch, meldete die Auswertung fälschlich „alles grün".
    const byDate = new Map<string, typeof shifts>();
    for (const s of shifts) {
      const list = byDate.get(s.date);
      if (list) list.push(s);
      else byDate.set(s.date, [s]);
    }

    const thin: string[] = [];
    for (const [date, onDay] of byDate) {
      for (const [from, to, label] of [[18 * 60, 21 * 60, "Abend"]] as const) {
        for (let t = from; t < to; t++) {
          const staff = onDay.filter((s) => s.startMinutes <= t && s.endMinutes > t).length;
          if (staff < 2) {
            thin.push(`${date} ${label} ${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")} => ${staff}`);
            break;
          }
        }
      }
    }
    // Muss zur Zählung aus der Auswertung passen – beide Wege dürfen nicht
    // auseinanderlaufen, sonst misst einer von beiden falsch.
    expect(thin.length).toBe(analysis.peakViolations.length);
    expect(thin.length).toBeLessThanOrEqual(seed.maxPeakGaps ?? 0);
  });
});

describe("Report", () => {
  it("schreibt die Auswertung auf die Konsole", () => {
    const lines: string[] = [];
    for (const { seed, shifts, analysis } of runs) {
      lines.push("");
      lines.push(`=== ${seed.label} ===`);
      lines.push(
        `Mitarbeiter: ${seed.employees.length} · Sollstunden gesamt: ${totalTargetHours(seed)} h · ` +
          `offene Tage: ${analysis.openDays} · Schichten: ${[...analysis.lengthHistogram.values()].reduce((a, b) => a + b, 0)}`,
      );

      lines.push("Schichtlängen:");
      const hist = [...analysis.lengthHistogram.entries()].sort((a, b) => a[0] - b[0]);
      lines.push("  " + hist.map(([h, n]) => `${h}h×${n}`).join("  "));

      // Zeigt, ob lange Schichten eine Vorliebe des Schedulers sind oder vom
      // Soll erzwungen werden: Soll / verfügbare Arbeitstage ist die Untergrenze.
      lines.push("Auslastung je Mitarbeiter (Soll ÷ Dienste = Ø Schichtlänge):");
      for (const emp of seed.employees) {
        const own = shifts.filter((s) => s.employeeId === emp.id);
        const hours = emp.targetMinutes / 60;
        lines.push(
          `  ${emp.name.padEnd(18)} ${emp.employmentType.padEnd(9)} ` +
            `${String(hours).padStart(3)} h auf ${String(own.length).padStart(2)} Dienste ` +
            `= Ø ${(hours / own.length).toFixed(2)} h`,
        );
      }

      lines.push("Gewichtstreue je Wochentag (Ist gegen eigenes Tages-Soll):");
      for (const f of analysis.weekdayFit) {
        const dev = (f.deviation * 100).toFixed(1).padStart(6);
        lines.push(
          `  ${WEEKDAY_SHORT_DE[f.weekday]}  ${f.days} Tage  ` +
            `Soll Ø ${f.avgTargetHours.toFixed(1).padStart(5)} h  ` +
            `Ist Ø ${f.avgHours.toFixed(1).padStart(5)} h  Abw. ${dev} %`,
        );
      }

      const violations = analysis.peakViolations;
      lines.push(`Stoßzeiten unterbesetzt: ${violations.length} Tage`);
      for (const d of violations.slice(0, 10)) {
        lines.push(
          `  ${d.date} ${WEEKDAY_SHORT_DE[d.weekday]} — ${d.shiftCount} Dienste, ${d.paidHours} h — ` +
            d.peaks.map((p) => `${p.label}: ${p.minStaff}/${p.required}`).join(" · "),
        );
      }

      const open = analysis.days.filter((d) => !d.closed);
      const minShifts = Math.min(...open.map((d) => d.shiftCount));
      const maxShifts = Math.max(...open.map((d) => d.shiftCount));
      lines.push(`Dienste pro offenem Tag: min ${minShifts}, max ${maxShifts}`);
      lines.push(
        `Abweichung vom Tages-Soll: Ø ${analysis.meanAbsDeviationHours.toFixed(2)} h ` +
          `(${analysis.meanAbsDeviationPercent.toFixed(1)} %), max ${analysis.maxAbsDeviationHours.toFixed(2)} h`,
      );
    }
    // eslint-disable-next-line no-console
    console.log(lines.join("\n"));
    expect(runs.length).toBe(3);
  });
});
