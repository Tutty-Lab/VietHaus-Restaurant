// VietHaus: Startbelegschaft, Öffnungszeiten und Wochenendgewicht im Planer.
import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { storeById } from "../stores";
import { parseIsoDate, weekdayKeyOf } from "../demand";
import { DEFAULT_WORK_HOURS } from "../workHours";

const store = storeById("viethaus");

describe("VietHaus", () => {
  const employees = store.sampleEmployees();
  const shifts = generateSchedule({
    year: 2026, month: 9, workHours: DEFAULT_WORK_HOURS, employees,
    rules: store.staffingRules, weights: store.dayWeights, storeTag: store.id,
  });

  it("Startbelegschaft: 5 Leute, 606 h", () => {
    expect(employees).toHaveLength(5);
    expect(employees.reduce((sum, e) => sum + e.targetMinutes, 0) / 60).toBe(606);
  });

  it("jeder Dienst liegt in 11:30–22:00, auch montags wird geplant", () => {
    for (const s of shifts) {
      expect(s.startMinutes).toBeGreaterThanOrEqual(11 * 60 + 30);
      expect(s.endMinutes).toBeLessThanOrEqual(22 * 60);
    }
    expect(shifts.some((s) => weekdayKeyOf(parseIsoDate(s.date)) === "monday")).toBe(true);
  });

  it("Samstag bekommt mehr Stunden als Montag", () => {
    const sum = (day: string) =>
      shifts.filter((s) => weekdayKeyOf(parseIsoDate(s.date)) === day).reduce((t, s) => t + s.paidMinutes, 0);
    expect(sum("saturday")).toBeGreaterThan(sum("monday"));
  });
});
