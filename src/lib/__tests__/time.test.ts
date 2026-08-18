import { describe, expect, it } from "vitest";
import {
  calculatePaidMinutes,
  calculatePause,
  minutesToDecimalHours,
  minutesToTime,
  presenceFromPaid,
  timeToMinutes,
} from "../time";

describe("timeToMinutes / minutesToTime", () => {
  it("konvertiert Uhrzeiten in Minuten", () => {
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("13:30")).toBe(810);
    expect(timeToMinutes("22:00")).toBe(1320);
  });

  it("ist invers zu minutesToTime", () => {
    for (const t of ["10:00", "13:30", "17:45", "22:00"]) {
      expect(minutesToTime(timeToMinutes(t))).toBe(t);
    }
  });

  it("wirft bei ungültigem Format", () => {
    expect(() => timeToMinutes("25:00")).toThrow();
    expect(() => timeToMinutes("abc")).toThrow();
  });
});

describe("calculatePause", () => {
  it("bis einschließlich 4 h ohne Pause", () => {
    expect(calculatePause(3 * 60)).toBe(0);
    expect(calculatePause(4 * 60)).toBe(0);
  });
  it("über 4 h bis unter 9 h sind es 30 Minuten", () => {
    expect(calculatePause(4 * 60 + 1)).toBe(30);
    expect(calculatePause(5 * 60)).toBe(30);
    expect(calculatePause(8 * 60)).toBe(30);
    expect(calculatePause(9 * 60 - 1)).toBe(30);
  });
  it("ab 9 h sind es 45 Minuten", () => {
    expect(calculatePause(9 * 60)).toBe(45);
  });
});

describe("calculatePaidMinutes / presenceFromPaid", () => {
  it("berechnet bezahlte Minuten aus Beginn/Ende/Pause", () => {
    // 12:00-20:00, keine Pause => 8 h
    expect(calculatePaidMinutes(720, 1200, 0)).toBe(480);
    // 16:00-20:00, keine Pause => 4 h
    expect(calculatePaidMinutes(960, 1200, 0)).toBe(240);
    // 11:30-20:30 mit 30 min Pause => 8,5 h bezahlt
    expect(calculatePaidMinutes(690, 1230, 30)).toBe(510);
  });
  it("presence = paid + Pause", () => {
    expect(presenceFromPaid(180)).toBe(180); // 3 h, keine Pause
    expect(presenceFromPaid(240)).toBe(240); // 4 h, keine Pause
    expect(presenceFromPaid(300)).toBe(330); // 5 h + 30 min
    expect(presenceFromPaid(420)).toBe(450); // 7 h + 30 min
    expect(presenceFromPaid(480)).toBe(510); // 8 h + 30 min
    expect(presenceFromPaid(540)).toBe(585); // 9 h + 45 min = 9,75 h Anwesenheit
  });
});

describe("minutesToDecimalHours", () => {
  it("formatiert deutsch mit Komma", () => {
    expect(minutesToDecimalHours(480)).toBe("8,00");
    expect(minutesToDecimalHours(450)).toBe("7,50");
  });
});
