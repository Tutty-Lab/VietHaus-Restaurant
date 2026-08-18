import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { DEFAULT_WORK_HOURS, type OverrideMap } from "../workHours";
import { SAMPLE_EMPLOYEES } from "../sampleData";

describe("Ausnahmen je Datum (Overrides)", () => {
  it("plant an geschlossenen Tagen keine Schicht – Soll bleibt exakt", () => {
    const overrides: OverrideMap = {
      "2026-08-08": { date: "2026-08-08", closed: true, note: "Betriebsruhe" },
    };
    const shifts = generateSchedule({
      year: 2026,
      month: 8,
      workHours: DEFAULT_WORK_HOURS,
      overrides,
      employees: SAMPLE_EMPLOYEES,
    });
    expect(shifts.filter((s) => s.date === "2026-08-08")).toHaveLength(0);

    const result = validateSchedule(SAMPLE_EMPLOYEES, shifts);
    expect(result.valid).toBe(true);
    expect(shifts.reduce((a, s) => a + s.paidMinutes, 0)).toBe(717 * 60);
  });

  it("halber Tag: Mitarbeiter arbeiten KÜRZERE Schichten (nicht frei), Soll exakt", () => {
    // 10:30–16:00 = 330 Min Fenster -> Schichten bis 5 h passen.
    const overrides: OverrideMap = {
      "2026-08-10": {
        date: "2026-08-10",
        closed: false,
        window: { startMinutes: 10 * 60 + 30, endMinutes: 16 * 60 },
        note: "halber Tag",
      },
    };
    const shifts = generateSchedule({
      year: 2026,
      month: 8,
      workHours: DEFAULT_WORK_HOURS,
      overrides,
      employees: SAMPLE_EMPLOYEES,
    });
    const onHalfDay = shifts.filter((x) => x.date === "2026-08-10");
    // Es wird an dem Tag gearbeitet – aber nur mit passenden (kurzen) Schichten.
    expect(onHalfDay.length).toBeGreaterThan(0);
    for (const s of onHalfDay) {
      expect(s.endMinutes - s.startMinutes).toBeLessThanOrEqual(330);
      expect(s.paidMinutes).toBeLessThanOrEqual(5 * 60);
      expect(s.startMinutes).toBeGreaterThanOrEqual(10 * 60 + 30);
      expect(s.endMinutes).toBeLessThanOrEqual(16 * 60);
    }
    const result = validateSchedule(SAMPLE_EMPLOYEES, shifts);
    expect(result.valid).toBe(true);
    expect(shifts.reduce((a, s) => a + s.paidMinutes, 0)).toBe(717 * 60);
  });
});
