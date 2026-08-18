// ============================================================================
// Kundennachfrage-Konzept: Tagesgewichte + gewünschte Spätschicht-Anteile.
// ============================================================================

import { eachDayOfInterval, endOfMonth, format, getDay, startOfMonth } from "date-fns";

export type WeekdayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

/**
 * Nachfrage-Gewichte je Wochentag (keine Mitarbeiterzahlen!).
 * Vorgabe des Chefs (VietHaus Restaurant): Umsatz am Samstag ist 1,5-mal so
 * hoch wie am Montag; voll wird es abends am Wochenende (Fr/Sa/So).
 *
 * BELEGT sind nur zwei Werte: Montag 1,0 als Anker und Samstag 1,5. Freitag,
 * Sonntag und Donnerstag sind interpoliert – Fr/So liegen laut Chef über den
 * Wochentagen, aber unter dem Samstag. Diese drei Zahlen sind der erste
 * Stellknopf, wenn der Plan sich in der Praxis schief anfühlt.
 * VietHaus hat keinen Ruhetag, alle sieben Tage sind offen. Das Gewicht
 * steuert nur, wie viele Stunden ein offener Tag bekommt.
 */
export const DAY_WEIGHTS: Record<WeekdayKey, number> = {
  monday: 1.0, // Anker: der ruhigste Tag laut Chef
  tuesday: 1.0,
  wednesday: 1.0,
  thursday: 1.05,
  friday: 1.35,
  saturday: 1.5, // belegt: Umsatz 1,5-mal Montag
  sunday: 1.4,
};

/**
 * Gewünschter Anteil an Spätschicht-Stunden je Wochentag.
 * VietHaus ist ein Restaurant mit Abendgeschäft (11:30–22:00). Das Gewicht liegt
 * deshalb ÜBER der Hälfte – anders als bei einem Mittags-Imbiss – und am
 * Wochenende deutlich höher: der Chef nennt ausdrücklich die ABENDE am
 * Freitag, Samstag und Sonntag als Stoßzeit.
 */
export const LATE_SHIFT_RATIOS: Record<WeekdayKey, number> = {
  monday: 0.55,
  tuesday: 0.55,
  wednesday: 0.55,
  thursday: 0.55,
  friday: 0.65,
  saturday: 0.65,
  sunday: 0.65,
};

/** date-fns getDay(): 0=So ... 6=Sa  ->  WeekdayKey. */
const WEEKDAY_BY_GETDAY: Record<number, WeekdayKey> = {
  0: "sunday",
  1: "monday",
  2: "tuesday",
  3: "wednesday",
  4: "thursday",
  5: "friday",
  6: "saturday",
};

export const WEEKDAY_LABELS_DE: Record<WeekdayKey, string> = {
  monday: "Montag",
  tuesday: "Dienstag",
  wednesday: "Mittwoch",
  thursday: "Donnerstag",
  friday: "Freitag",
  saturday: "Samstag",
  sunday: "Sonntag",
};

export const WEEKDAY_SHORT_DE: Record<WeekdayKey, string> = {
  monday: "Mo",
  tuesday: "Di",
  wednesday: "Mi",
  thursday: "Do",
  friday: "Fr",
  saturday: "Sa",
  sunday: "So",
};

// Vietnamesische Wochentage – für die App-Oberfläche.
export const WEEKDAY_LABELS_VI: Record<WeekdayKey, string> = {
  monday: "Thứ Hai",
  tuesday: "Thứ Ba",
  wednesday: "Thứ Tư",
  thursday: "Thứ Năm",
  friday: "Thứ Sáu",
  saturday: "Thứ Bảy",
  sunday: "Chủ Nhật",
};

export const WEEKDAY_SHORT_VI: Record<WeekdayKey, string> = {
  monday: "T2",
  tuesday: "T3",
  wednesday: "T4",
  thursday: "T5",
  friday: "T6",
  saturday: "T7",
  sunday: "CN",
};

export function weekdayKeyOf(date: Date): WeekdayKey {
  return WEEKDAY_BY_GETDAY[getDay(date)];
}

/** Alle Kalendertage eines Monats als ISO-Strings "yyyy-MM-dd". month ist 1-basiert. */
export function datesOfMonth(year: number, month: number): string[] {
  const first = startOfMonth(new Date(year, month - 1, 1));
  const last = endOfMonth(first);
  return eachDayOfInterval({ start: first, end: last }).map((d) => format(d, "yyyy-MM-dd"));
}

export function dayWeightOf(isoDate: string): number {
  return DAY_WEIGHTS[weekdayKeyOf(parseIsoDate(isoDate))];
}

export function lateRatioOf(isoDate: string): number {
  return LATE_SHIFT_RATIOS[weekdayKeyOf(parseIsoDate(isoDate))];
}

/** ISO "yyyy-MM-dd" -> lokales Date (ohne Zeitzonen-Verschiebung). */
export function parseIsoDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d);
}
