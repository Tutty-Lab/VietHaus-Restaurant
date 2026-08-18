import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { maxConsecutiveRun } from "../consecutive";
import { calculatePause } from "../time";
import { DEFAULT_WORK_HOURS, resolveDay, type OverrideMap } from "../workHours";
import { publicHolidays } from "../holidays";
import { splitTargetHours } from "../splitTargetHours";
import type { Employee, Shift } from "../../types";

const mk = (id: string, type: Employee["employmentType"], hours: number): Employee => ({
  id,
  name: id,
  employmentType: type,
  targetMinutes: hours * 60,
});

/** Prüft alle harten Regeln, die der Scheduler laut Kopfkommentar zusichert. */
function audit(shifts: Shift[], employees: Employee[], year: number, overrides: OverrideMap = {}) {
  const problems: string[] = [];
  const holidays = publicHolidays(year);

  // 1. Monats-Soll exakt getroffen
  for (const e of employees) {
    const sum = shifts.filter((s) => s.employeeId === e.id).reduce((a, s) => a + s.paidMinutes, 0);
    if (sum !== e.targetMinutes) {
      problems.push(`${e.id}: ${sum / 60}h thay vì ${e.targetMinutes / 60}h`);
    }
  }

  // 2. Höchstens ein Dienst je Mitarbeiter und Tag
  for (const e of employees) {
    const dates = shifts.filter((s) => s.employeeId === e.id).map((s) => s.date);
    if (new Set(dates).size !== dates.length) problems.push(`${e.id}: trùng ngày`);
  }

  // 3. Höchstens 6 aufeinanderfolgende Arbeitstage
  for (const e of employees) {
    const dates = shifts.filter((s) => s.employeeId === e.id).map((s) => s.date);
    const run = maxConsecutiveRun(dates);
    if (run > 6) problems.push(`${e.id}: ${run} ngày liên tiếp`);
  }

  // 4. Schicht liegt im Zeitfenster des Tages und nicht an geschlossenen Tagen
  for (const s of shifts) {
    const day = resolveDay(DEFAULT_WORK_HOURS, s.date, holidays, overrides);
    if (day.closed) {
      problems.push(`${s.date}: có ca dù đóng cửa`);
      continue;
    }
    if (s.startMinutes < day.window.startMinutes || s.endMinutes > day.window.endMinutes) {
      problems.push(`${s.date}: ca ${s.startMinutes}-${s.endMinutes} ngoài khung`);
    }
  }

  // 5. Pausenregel + Rechenweg stimmen
  for (const s of shifts) {
    if (s.pauseMinutes !== calculatePause(s.paidMinutes)) {
      problems.push(`${s.date}/${s.employeeId}: nghỉ ${s.pauseMinutes}p cho ca ${s.paidMinutes / 60}h`);
    }
    if (s.endMinutes - s.startMinutes - s.pauseMinutes !== s.paidMinutes) {
      problems.push(`${s.date}/${s.employeeId}: giờ công không khớp`);
    }
    if (s.paidMinutes < 3 * 60 || s.paidMinutes > 9 * 60) {
      problems.push(`${s.date}/${s.employeeId}: ca ${s.paidMinutes / 60}h ngoài 3..9h`);
    }
  }

  return problems;
}

describe("splitTargetHours: định mức nào chia được", () => {
  it("chấp nhận mọi số giờ chia được thành ca 4..8h", () => {
    for (let h = 4; h <= 200; h++) {
      expect(() => splitTargetHours(h, "VOLLZEIT")).not.toThrow();
    }
  });

  it("từ chối số giờ quá nhỏ (1, 2)", () => {
    for (const h of [1, 2]) {
      expect(() => splitTargetHours(h, "VOLLZEIT")).toThrow();
    }
    // 3h giờ là hợp lệ (một ca 3h).
    expect(() => splitTargetHours(3, "VOLLZEIT")).not.toThrow();
  });
});

describe("Scheduler: chạy thử 12 tháng liên tiếp", () => {
  // Sonntag ist geschlossen -> die Monatskapazität sinkt. Diese Sollwerte sind
  // in JEDEM Monat 2026 erreichbar (auch im kurzen Februar).
  const employees = [
    mk("VZ1", "VOLLZEIT", 150),
    mk("VZ2", "VOLLZEIT", 152),
    mk("VZ3", "VOLLZEIT", 148),
    mk("VZ4", "VOLLZEIT", 150),
    mk("TZ1", "TEILZEIT", 40),
    mk("TZ2", "TEILZEIT", 55),
    mk("TZ3", "TEILZEIT", 55),
    mk("TZ4", "TEILZEIT", 79),
    mk("TZ5", "TEILZEIT", 80),
  ];

  for (let month = 1; month <= 12; month++) {
    it(`tháng ${month}/2026 giữ đủ mọi quy tắc cứng`, () => {
      const shifts = generateSchedule({ year: 2026, month, workHours: DEFAULT_WORK_HOURS, employees });
      expect(audit(shifts, employees, 2026)).toEqual([]);
    });
  }
});

describe("Scheduler: định mức cao ép sát số ngày trong tháng", () => {
  // 1 người, 26 ca 8h = 208h trong tháng 2 (28 ngày) -> buộc phải làm
  // nhiều ngày liên tiếp. Đây là chỗ dễ phá quy tắc 6 ngày nhất.
  const cases: Array<{ ten: string; emps: Employee[]; year: number; month: number }> = [
    { ten: "1 người 208h / tháng 2 (28 ngày)", emps: [mk("A", "VOLLZEIT", 208)], year: 2026, month: 2 },
    { ten: "1 người 224h / tháng 2", emps: [mk("A", "VOLLZEIT", 224)], year: 2026, month: 2 },
    { ten: "1 người 232h / tháng 1 (31 ngày)", emps: [mk("A", "VOLLZEIT", 232)], year: 2026, month: 1 },
    { ten: "2 người 200h / tháng 4 (30 ngày)", emps: [mk("A", "VOLLZEIT", 200), mk("B", "VOLLZEIT", 200)], year: 2026, month: 4 },
  ];

  for (const c of cases) {
    it(c.ten, () => {
      let shifts: Shift[];
      try {
        shifts = generateSchedule({
          year: c.year,
          month: c.month,
          workHours: DEFAULT_WORK_HOURS,
          employees: c.emps,
        });
      } catch (err) {
        // Từ chối thẳng cũng là hành vi đúng – miễn là không tạo lịch sai.
        expect(err).toBeInstanceOf(Error);
        return;
      }
      expect(audit(shifts, c.emps, c.year)).toEqual([]);
    });
  }
});

describe("Scheduler: có ngày đóng cửa", () => {
  it("không xếp ca vào ngày đóng cửa và vẫn đủ định mức", () => {
    // März hat zusätzlich zum geschlossenen Sonntag noch 5 zu geschlossene
    // Montage -> deutlich weniger offene Tage, daher moderate Sollwerte.
    const employees = [mk("VZ1", "VOLLZEIT", 112), mk("TZ1", "TEILZEIT", 48)];
    const overrides: OverrideMap = {};
    for (const d of ["2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23", "2026-03-30"]) {
      overrides[d] = { date: d, closed: true };
    }
    const shifts = generateSchedule({
      year: 2026,
      month: 3,
      workHours: DEFAULT_WORK_HOURS,
      employees,
      overrides,
    });
    expect(audit(shifts, employees, 2026, overrides)).toEqual([]);
  });
});
