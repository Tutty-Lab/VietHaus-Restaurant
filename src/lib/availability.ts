// ============================================================================
// Wann darf eine Person überhaupt an einem Tag eingeplant werden?
//
// VietHaus kennt (noch) keinen Urlaub; die einzige Einschränkung sind feste
// Arbeitstage: „diese Kraft kommt nur Freitag und Sonntag" bzw. „hat montags
// frei" (availableWeekdays). Alles steht hier an EINER Stelle, weil der
// Scheduler an mehreren Stellen Termine vergibt.
// ============================================================================

import type { Employee } from "../types";
import { parseIsoDate, weekdayKeyOf } from "./demand";

/**
 * Arbeitet diese Person an diesem Wochentag überhaupt? Leere/fehlende Liste =
 * keine Einschränkung.
 */
export function worksOnWeekday(employee: Employee, isoDate: string): boolean {
  const tage = employee.availableWeekdays;
  if (!tage || tage.length === 0) return true;
  return tage.includes(weekdayKeyOf(parseIsoDate(isoDate)));
}

/** Darf diese Person an diesem Datum arbeiten? */
export function mayWorkOn(employee: Employee, isoDate: string): boolean {
  return worksOnWeekday(employee, isoDate);
}
