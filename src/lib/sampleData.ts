// ============================================================================
// Beispieldaten von VietHaus (Dippoldiswalde). Monatsstunden, nicht je Woche.
// ============================================================================

import type { Employee, Schedule } from "../types";
import { DEFAULT_WORK_HOURS } from "./workHours";

export function makeEmployee(
  id: string,
  name: string,
  employmentType: Employee["employmentType"],
  targetHours: number,
): Employee {
  return { id, name, employmentType, targetMinutes: Math.round(targetHours * 60) };
}

/** Mitarbeiter mit WOCHENvertrag (hier nicht im Einsatz, bleibt für die Oberfläche). */
export function makeWeekly(
  id: string,
  name: string,
  employmentType: Employee["employmentType"],
  weeklyHours: number,
): Employee {
  return { id, name, employmentType, targetMinutes: 0, weeklyHours };
}

/**
 * Kunden-Demo („Demo Restaurant"): 10 erfundene Personen – 5 Vollzeit, 3 Teilzeit,
 * 2 Minijob, 6 Bồi und 4 Bếp (1.196 h im Monat).
 */
/** Startbelegschaft wie in der alten App: 3 Vollzeit, 2 Minijob. */
export function vietHausEmployees(): Employee[] {
  return [
    makeEmployee("ST1", "ST1", "VOLLZEIT", 200),
    makeEmployee("ST2", "ST2", "VOLLZEIT", 160),
    makeEmployee("ST3", "ST3", "VOLLZEIT", 160),
    makeEmployee("MJ1", "MJ1", "MINIJOB", 43),
    makeEmployee("MJ2", "MJ2", "MINIJOB", 43),
  ];
}

/** Belegschaft der Standard-Filiale – für Tests und Altaufrufe. */
export const SAMPLE_EMPLOYEES: Employee[] = vietHausEmployees();

export function createSampleSchedule(): Schedule {
  return {
    companyName: "VietHaus Restaurant",
    address: "Herrengasse 19, 01744 Dippoldiswalde",
    year: 2026,
    month: 8, // August
    workHours: structuredClone(DEFAULT_WORK_HOURS),
    dateOverrides: [],
    employees: vietHausEmployees(),
    shifts: [],
  };
}
