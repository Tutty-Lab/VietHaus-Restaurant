// ============================================================================
// Test-Belegschaften für drei Monate.
//
// Angaben des Chefs (VietHaus Restaurant):
//   - 3 Vollzeit: eine mit 200 h/Monat, zwei mit je 160 h/Monat
//   - 2 Minijob: je 43 h/Monat (rund 10 h/Woche)
//   - keine festen Schichten für die Vollzeit-Kräfte, kein fester Ruhetag:
//     die App verteilt frei im Fenster 11:30-22:00, sieben Tage die Woche
//
// Der Laden hat KEINEN Ruhetag. Bei 30 offenen Tagen und einem 10,5-h-Fenster
// kostet die Grundabdeckung (durchgehend 1 Person, abends 2) rund 405 h im
// Monat - die 606 h der Stammbesetzung reichen dafür mit Reserve.
//
// Hinweis zum Datenmodell: Schedule hält immer GENAU EINEN Monat. Diese drei
// Monate existieren nebeneinander nur hier als Fixture.
// ============================================================================

import type { Employee, Schedule } from "../types";
import { COMPANY_ADDRESS, COMPANY_NAME } from "./company";
import { makeEmployee } from "./sampleData";
import { DEFAULT_WORK_HOURS } from "./workHours";

export type SeedMonth = {
  year: number;
  month: number; // 1-basiert
  label: string;
  employees: Employee[];
  /**
   * Wie viele Tage dürfen die Stoßzeit verfehlen? Normalfall 0.
   *
   * Bewusst hier sichtbar statt in der Prüfung versteckt: der Scheduler ist
   * eine Heuristik, keine vollständige Suche. Ein Wert > 0 heißt, dass die
   * Stundensumme rechnerisch reichen würde, der greedy Lauf die Verteilung
   * aber nicht findet - eine bekannte Schwäche, kein akzeptierter Zustand.
   */
  maxPeakGaps?: number;
};

/** Juni 2026 - heutige Besetzung: 3 Vollzeit + 2 Minijob, zusammen 606 h. */
const JUNE_2026: Employee[] = [
  makeEmployee("vz-1", "Vollzeit 1", "VOLLZEIT", 200),
  makeEmployee("vz-2", "Vollzeit 2", "VOLLZEIT", 160),
  makeEmployee("vz-3", "Vollzeit 3", "VOLLZEIT", 160),
  makeEmployee("mini-1", "Mini 1", "MINIJOB", 43),
  makeEmployee("mini-2", "Mini 2", "MINIJOB", 43),
];

/** Juli 2026 - eine Minijob-Kraft im Urlaub, zusammen 563 h. */
const JULY_2026: Employee[] = [
  makeEmployee("vz-1", "Vollzeit 1", "VOLLZEIT", 200),
  makeEmployee("vz-2", "Vollzeit 2", "VOLLZEIT", 160),
  makeEmployee("vz-3", "Vollzeit 3", "VOLLZEIT", 160),
  makeEmployee("mini-1", "Mini 1", "MINIJOB", 43),
];

/** August 2026 - Minijobs am gesetzlichen Limit (52 h = 12 h/Woche), 624 h. */
const AUGUST_2026: Employee[] = [
  makeEmployee("vz-1", "Vollzeit 1", "VOLLZEIT", 200),
  makeEmployee("vz-2", "Vollzeit 2", "VOLLZEIT", 160),
  makeEmployee("vz-3", "Vollzeit 3", "VOLLZEIT", 160),
  makeEmployee("mini-1", "Mini 1", "MINIJOB", 52),
  makeEmployee("mini-2", "Mini 2", "MINIJOB", 52),
];

/** Die drei Monate, ältester zuerst. */
export const SEED_MONTHS: SeedMonth[] = [
  { year: 2026, month: 6, label: "Juni 2026", employees: JUNE_2026 },
  { year: 2026, month: 7, label: "Juli 2026", employees: JULY_2026 },
  { year: 2026, month: 8, label: "August 2026", employees: AUGUST_2026 },
];


/** Baut einen leeren Schedule (ohne Schichten) für einen Seed-Monat. */
export function scheduleForSeed(seed: SeedMonth): Schedule {
  return {
    companyName: COMPANY_NAME,
    address: COMPANY_ADDRESS,
    year: seed.year,
    month: seed.month,
    workHours: structuredClone(DEFAULT_WORK_HOURS),
    dateOverrides: [],
    employees: seed.employees.map((e) => ({ ...e })),
    shifts: [],
  };
}

/** Summe der Sollstunden eines Seed-Monats (für Kapazitäts-Checks). */
export function totalTargetHours(seed: SeedMonth): number {
  return seed.employees.reduce((sum, e) => sum + e.targetMinutes, 0) / 60;
}
