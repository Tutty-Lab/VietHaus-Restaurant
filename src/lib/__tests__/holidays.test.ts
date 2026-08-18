import { describe, expect, it } from "vitest";
import { bussUndBettag, easterSunday, publicHolidays, publicHolidayNames } from "../holidays";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { DEFAULT_WORK_HOURS } from "../workHours";
import { SAMPLE_EMPLOYEES } from "../sampleData";
import { format } from "date-fns";

describe("Feiertage (Sachsen)", () => {
  it("berechnet Ostersonntag korrekt", () => {
    expect(format(easterSunday(2026), "yyyy-MM-dd")).toBe("2026-04-05");
    expect(format(easterSunday(2024), "yyyy-MM-dd")).toBe("2024-03-31");
  });

  it("enthält die festen und beweglichen Sachsen-Feiertage 2026", () => {
    const h = publicHolidays(2026);
    expect(h.has("2026-01-01")).toBe(true); // Neujahr
    expect(h.has("2026-04-03")).toBe(true); // Karfreitag
    expect(h.has("2026-04-06")).toBe(true); // Ostermontag
    expect(h.has("2026-05-01")).toBe(true); // Tag der Arbeit
    expect(h.has("2026-05-14")).toBe(true); // Christi Himmelfahrt
    expect(h.has("2026-05-25")).toBe(true); // Pfingstmontag
    expect(h.has("2026-10-31")).toBe(true); // Reformationstag (Sachsen)
    expect(h.has("2026-10-03")).toBe(true); // Deutsche Einheit
    expect(h.has("2026-11-18")).toBe(true); // Buß- und Bettag (Mittwoch vor dem 23.11.)
    expect(h.has("2026-12-25")).toBe(true);
    expect(h.has("2026-12-26")).toBe(true);
    expect(h.size).toBe(11);
  });

  it("enthält KEINE West-/Brandenburg-Feiertage", () => {
    const h = publicHolidays(2026);
    expect(h.has("2026-04-05")).toBe(false); // Ostersonntag – nur Brandenburg
    expect(h.has("2026-05-24")).toBe(false); // Pfingstsonntag – nur Brandenburg
    expect(h.has("2026-06-04")).toBe(false); // Fronleichnam – in Dippoldiswalde nicht
    expect(h.has("2026-11-01")).toBe(false); // Allerheiligen – nicht in Sachsen
  });


  it("legt den Buß- und Bettag immer auf den Mittwoch vor dem 23.11.", () => {
    // 2025: 23.11. ist ein Sonntag -> 19.11.; 2026: 23.11. ist ein Montag -> 18.11.
    for (const [year, iso] of [[2025, "2025-11-19"], [2026, "2026-11-18"], [2027, "2027-11-17"]] as const) {
      const d = bussUndBettag(year);
      expect(format(d, "yyyy-MM-dd")).toBe(iso);
      expect(d.getDay()).toBe(3);
    }
  });

  it("Set und Namen bleiben deckungsgleich", () => {
    for (const year of [2024, 2026, 2027]) {
      expect(publicHolidays(year).size).toBe(publicHolidayNames(year).size);
    }
  });
});

describe("Scheduler mit Feiertagen (Dezember 2026)", () => {
  it("bleibt gültig und trifft jedes Soll exakt", () => {
    const shifts = generateSchedule({
      year: 2026,
      month: 12, // enthält 1. und 2. Weihnachtstag
      workHours: DEFAULT_WORK_HOURS,
      employees: SAMPLE_EMPLOYEES,
    });
    const result = validateSchedule(SAMPLE_EMPLOYEES, shifts);
    expect(result.valid).toBe(true);
    const total = shifts.reduce((s, x) => s + x.paidMinutes, 0);
    expect(total).toBe(717 * 60);
  });

  it("plant Schichten an Feiertagen im 11:30–22:00-Fenster", () => {
    const shifts = generateSchedule({
      year: 2026,
      month: 12,
      workHours: DEFAULT_WORK_HOURS,
      employees: SAMPLE_EMPLOYEES,
    });
    // 25.12. ist Feiertag -> eigenes Fenster: frühester Beginn 11:30 (690).
    const xmas = shifts.filter((s) => s.date === "2026-12-25");
    for (const s of xmas) {
      expect(s.startMinutes).toBeGreaterThanOrEqual(11 * 60 + 30);
      expect(s.endMinutes).toBeLessThanOrEqual(22 * 60);
    }
  });
});
