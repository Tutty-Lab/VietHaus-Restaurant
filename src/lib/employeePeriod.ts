import type { Employee, Schedule } from "../types";
import { datesOfMonth } from "./demand";
import { publicHolidays } from "./holidays";
import { resolveDay } from "./workHours";
import { isEmployedOn } from "./availability";

export function employmentPeriodError(start: string, end: string): string | null {
  for (const date of [start, end]) {
    if (!date) continue;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== date) return "Ngày không hợp lệ.";
  }
  return start && end && start > end ? "Ngày nghỉ việc phải bằng hoặc sau ngày vào làm." : null;
}

export function openDatesFor(schedule: Pick<Schedule, "year" | "month" | "workHours" | "dateOverrides">): string[] {
  const holidays = publicHolidays(schedule.year);
  const overrides = Object.fromEntries(schedule.dateOverrides.map(o => [o.date, o]));
  return datesOfMonth(schedule.year, schedule.month).filter(d => !resolveDay(schedule.workHours,d,holidays,overrides).closed);
}

/** Contract remains unchanged. Prorate by open days, rounded to whole hours supported by this scheduler. */
export function monthlyTargetMinutesFor(employee: Employee, openDates: readonly string[]): number {
  if (!employee.startDate && !employee.endDate) return employee.targetMinutes;
  if (!openDates.length) return 0;
  const employed = openDates.filter(d => isEmployedOn(employee,d)).length;
  if (employed === openDates.length) return employee.targetMinutes;
  return Math.round(employee.targetMinutes * employed / openDates.length / 60) * 60;
}

export function updateEmployeeInSchedule(schedule: Schedule, id: string, patch: Partial<Employee>): Schedule {
  if (schedule.lockedAt) return schedule;
  const before = schedule.employees.find(e => e.id === id);
  if (!before) return schedule;
  const employee = {...before,...patch};
  if (employmentPeriodError(employee.startDate ?? "", employee.endDate ?? "")) return schedule;
  return {...schedule, employees: schedule.employees.map(e => e.id === id ? employee : e),
    shifts: schedule.shifts.filter(s => s.employeeId !== id || isEmployedOn(employee,s.date))};
}
