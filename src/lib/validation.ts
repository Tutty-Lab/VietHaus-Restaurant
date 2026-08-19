// ============================================================================
// Validierung des Dienstplans gegen alle geforderten Regeln.
// ============================================================================

import {
  MAX_MINIJOB_EMPLOYEES,
  MAX_STAMM_EMPLOYEES,
  MINIJOB_MAX_MONTHLY_HOURS,
  type Employee,
  type Shift,
} from "../types";
import { calculatePause } from "./time";
import { maxConsecutiveRun } from "./consecutive";

export type ValidationError = {
  employeeId?: string;
  date?: string;
  message: string;
};

export type EmployeeSummary = {
  employee: Employee;
  assignedMinutes: number;
  targetMinutes: number;
  diffMinutes: number; // assigned - target
  maxConsecutiveDays: number;
  shiftCount: number;
};

export type ValidationResult = {
  valid: boolean;
  errors: ValidationError[];
  summaries: EmployeeSummary[];
};

const MAX_PAID_MINUTES = 9 * 60;
const MAX_CONSECUTIVE_DAYS = 6;

export function validateSchedule(
  employees: Employee[],
  shifts: Shift[],
): ValidationResult {
  const errors: ValidationError[] = [];

  // ── Vorgaben des Betriebs zur Belegschaft ─────────────────────────────────
  // Diese Regeln haengen nicht am Plan, sondern an der Mitarbeiterliste. Sie
  // stehen trotzdem hier, damit ein Verstoss nicht erst beim Lohnbuero auffaellt.
  const stammCount = employees.filter((e) => e.employmentType !== "MINIJOB").length;
  const minijobCount = employees.length - stammCount;

  if (stammCount > MAX_STAMM_EMPLOYEES) {
    errors.push({
      message: `Quá số thợ chính: ${stammCount} người, tối đa ${MAX_STAMM_EMPLOYEES}.`,
    });
  }
  if (minijobCount > MAX_MINIJOB_EMPLOYEES) {
    errors.push({
      message: `Quá số Minijob: ${minijobCount} người, tối đa ${MAX_MINIJOB_EMPLOYEES}.`,
    });
  }
  for (const emp of employees) {
    if (emp.employmentType !== "MINIJOB") continue;
    const hours = emp.targetMinutes / 60;
    if (hours > MINIJOB_MAX_MONTHLY_HOURS) {
      errors.push({
        employeeId: emp.id,
        message:
          `${emp.name}: Minijob ${hours}h/tháng vượt ${MINIJOB_MAX_MONTHLY_HOURS}h theo hợp đồng.`,
      });
    }
  }
  const shiftsByEmployee = new Map<string, Shift[]>();
  for (const emp of employees) shiftsByEmployee.set(emp.id, []);
  for (const shift of shifts) {
    if (!shiftsByEmployee.has(shift.employeeId)) {
      shiftsByEmployee.set(shift.employeeId, []);
    }
    shiftsByEmployee.get(shift.employeeId)!.push(shift);
  }

  // Regeln je einzelner Schicht.
  for (const shift of shifts) {
    const presence = shift.endMinutes - shift.startMinutes;
    const expectedPaid = presence - shift.pauseMinutes;
    const expectedPause = calculatePause(shift.paidMinutes);

    if (shift.endMinutes <= shift.startMinutes) {
      errors.push({
        employeeId: shift.employeeId,
        date: shift.date,
        message: `Giờ ra không sau giờ vào (${shift.date}).`,
      });
    }
    if (shift.paidMinutes > MAX_PAID_MINUTES) {
      errors.push({
        employeeId: shift.employeeId,
        date: shift.date,
        message: `Quá 9 giờ công ngày ${shift.date}.`,
      });
    }
    if (shift.paidMinutes !== expectedPaid) {
      errors.push({
        employeeId: shift.employeeId,
        date: shift.date,
        message: `Giờ công không khớp giờ vào/ra/nghỉ ngày ${shift.date}.`,
      });
    }
    if (shift.pauseMinutes !== expectedPause) {
      errors.push({
        employeeId: shift.employeeId,
        date: shift.date,
        message: `Sai giờ nghỉ ngày ${shift.date}: ${shift.pauseMinutes} thay vì ${expectedPause} phút.`,
      });
    }
  }

  const summaries: EmployeeSummary[] = [];

  for (const emp of employees) {
    const empShifts = shiftsByEmployee.get(emp.id) ?? [];

    // Höchstens ein Dienst pro Tag.
    const seenDates = new Set<string>();
    for (const shift of empShifts) {
      if (seenDates.has(shift.date)) {
        errors.push({
          employeeId: emp.id,
          date: shift.date,
          message: `Có nhiều hơn một ca ngày ${shift.date}.`,
        });
      }
      seenDates.add(shift.date);
    }

    const assignedMinutes = empShifts.reduce((sum, s) => sum + s.paidMinutes, 0);
    const maxRun = maxConsecutiveRun(empShifts.map((s) => s.date));

    if (assignedMinutes !== emp.targetMinutes) {
      errors.push({
        employeeId: emp.id,
        message: `${emp.name}: chưa đạt giờ định mức: ${assignedMinutes / 60} h thay vì ${emp.targetMinutes / 60} h.`,
      });
    }
    if (maxRun > MAX_CONSECUTIVE_DAYS) {
      errors.push({
        employeeId: emp.id,
        message: `${emp.name}: làm quá 6 ngày liên tiếp (${maxRun}).`,
      });
    }

    summaries.push({
      employee: emp,
      assignedMinutes,
      targetMinutes: emp.targetMinutes,
      diffMinutes: assignedMinutes - emp.targetMinutes,
      maxConsecutiveDays: maxRun,
      shiftCount: empShifts.length,
    });
  }

  return { valid: errors.length === 0, errors, summaries };
}
