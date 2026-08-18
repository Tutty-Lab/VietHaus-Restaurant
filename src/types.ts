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
 * Vorgaben des Betriebs zur Belegschaft (VietHaus Restaurant):
 * höchstens drei Stammkräfte (Vollzeit oder Teilzeit) und zwei Minijobs –
 * das ist die heutige Besetzung: 3 Vollzeit + 2 Minijob.
 * Wird das nicht eingehalten, plant die App trotzdem – die Mitarbeiterliste
 * weist aber darauf hin.
 */
export const MAX_STAMM_EMPLOYEES = 3;
export const MAX_MINIJOB_EMPLOYEES = 2;

/**
 * Minijob: höchstens 12 Stunden pro Woche, gerechnet wird aber im Monat.
 * 12 h x 52/12 Wochen = 52 h im Monat.
 */
export const MINIJOB_MAX_WEEKLY_HOURS = 12;
export const MINIJOB_MAX_MONTHLY_HOURS = Math.floor((MINIJOB_MAX_WEEKLY_HOURS * 52) / 12);

export type ShiftType = "EARLY" | "LATE" | "CUSTOM";

export type Employee = {
  id: string;
  name: string;
  employmentType: EmploymentType;
  /** Monatliches Soll in Minuten (Integer). 176 h => 10560. */
  targetMinutes: number;
  /**
   * Häkchen „Lưu" in der Mitarbeiterliste: vom Nutzer gesetzte Bestätigung,
   * dass die Daten dieser Person geprüft und übernommen sind. Rein als Merker
   * gedacht – auf die Planung hat das Feld keinen Einfluss.
   */
  saved?: boolean;
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
