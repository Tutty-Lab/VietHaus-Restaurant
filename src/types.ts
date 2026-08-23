// ============================================================================
// Zentrale Datentypen. Intern wird IMMER in Minuten (Integer) gerechnet,
// niemals mit Fließkomma-Stunden.
// ============================================================================

import type { DateOverride, WorkHoursConfig } from "./lib/workHours";

/**
 * Anstellungsart. MINIJOB ist arbeitsrechtlich eine Form der Teilzeit und wird
 * bei der Schichtplanung auch genauso behandelt – die Trennung dient der
 * Obergrenze und der Belegschaftsstruktur, nicht der Planung selbst.
 */
export type EmploymentType = "VOLLZEIT" | "TEILZEIT" | "MINIJOB";

/**
 * Höchstzahl der Beschäftigten – gezählt wird die GESAMTE Belegschaft.
 *
 * Früher standen hier zwei getrennte Zahlen (höchstens 3 Stammkräfte und 2
 * Minijobs, die heutige Besetzung). Der Betrieb zählt aber nur die Köpfe: wie
 * sich die fünf Leute auf Vollzeit, Teilzeit und Minijob verteilen, ist seine
 * Sache und keine Regel der App.
 *
 * Angabe des Betriebs, keine Rechtsvorschrift – deshalb eine Warnung und kein
 * harter Riegel.
 */
export const MAX_EMPLOYEES = 5;

/**
 * Minijob bei VietHaus: 43 Stunden im Monat laut Vertrag.
 *
 * Anders als anderswo ist das hier KEINE aus Wochenstunden abgeleitete Decke,
 * sondern die vertraglich vereinbarte Menge, die der Betrieb genannt hat. Wer
 * mehr einträgt, bekommt einen Hinweis in der Mitarbeiterliste.
 */
export const MINIJOB_MAX_MONTHLY_HOURS = 43;

export type ShiftType = "EARLY" | "LATE" | "CUSTOM";

export type Employee = {
  id: string;
  name: string;
  employmentType: EmploymentType;
  /** Monatliches Soll in Minuten (Integer). 176 h => 10560. */
  targetMinutes: number;
};

export type Shift = {
  id: string;
  employeeId: string;
  /** ISO-Datum "yyyy-MM-dd". */
  date: string;
  startMinutes: number;
  endMinutes: number;
  pauseMinutes: number;
  /** Bezahlte Arbeitszeit in Minuten = presence - pause. */
  paidMinutes: number;
  shiftType: ShiftType;
  /** true = automatisch generiert, false = manuell hinzugefügt/geändert. */
  generated: boolean;
};

export type Schedule = {
  companyName: string;
  /** Anschrift des Betriebs (erscheint auf dem Stundenzettel). */
  address: string;
  year: number;
  /** 1-basiert: 1 = Januar ... 12 = Dezember. */
  month: number;
  /** Arbeitszeit-Fenster (giờ làm) je Wochentag + Feiertag. */
  workHours: WorkHoursConfig;
  /** Ausnahmen für einzelne Daten (geschlossen / abweichende Zeiten). */
  dateOverrides: DateOverride[];
  employees: Employee[];
  shifts: Shift[];
  /**
   * Zeitpunkt der ersten Wochen-Ausgabe (ISO). Gesetzt = der Monat ist
   * gesperrt und darf nicht mehr geändert werden.
   *
   * Hintergrund: sobald eine Woche ausgedruckt im Laden hängt, muss der Stand
   * im System exakt dem Papier entsprechen – bei einer Kontrolle wird genau
   * das verglichen. Entsperren geht nur bewusst über die Oberfläche.
   */
  lockedAt?: string;
  /** Bereits gedruckte Wochen, als ISO-Datum des jeweiligen Montags. */
  printedWeeks?: string[];
};

/** Ein einzelnes zu verplanendes Schicht-Token (Ergebnis von splitTargetHours). */
export type ShiftToken = {
  employeeId: string;
  paidMinutes: number;
};
