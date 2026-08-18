// ============================================================================
// Gesetzliche Feiertage in SACHSEN – der Laden liegt in Dippoldiswalde (01744),
// also Freistaat Sachsen. Bewegliche Feiertage werden über die Osterformel
// (Gauß/Computus) berechnet.
//
// Besonderheit Sachsen (SächsSFG): evangelisch geprägt – es gelten der
// Reformationstag (31.10.) und der Buß- und Bettag (Mittwoch vor dem 23.11.),
// den es sonst nirgends mehr als Feiertag gibt. KEINE Feiertage sind hier
// Allerheiligen und Fronleichnam (Fronleichnam gilt in Sachsen nur in
// einzelnen sorbischen Gemeinden des Kreises Bautzen – Dippoldiswalde liegt
// im Kreis Sächsische Schweiz-Osterzgebirge und gehört nicht dazu).
// Ebenfalls keine Feiertage: Ostersonntag/Pfingstsonntag (nur Brandenburg).
// ============================================================================

import { addDays, format } from "date-fns";

/** Ostersonntag eines Jahres (Gauß'sche Osterformel, gregorianisch). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = März, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function iso(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/**
 * Buß- und Bettag: der Mittwoch VOR dem 23. November. Fällt der 23. selbst auf
 * einen Mittwoch, ist es der 16. – deshalb wird ab dem 22. rückwärts gesucht.
 */
export function bussUndBettag(year: number): Date {
  const d = new Date(year, 10, 22); // 22. November
  while (d.getDay() !== 3) d.setDate(d.getDate() - 1);
  return d;
}

/** Datum -> Name aller gesetzlichen Feiertage in Sachsen eines Jahres. */
export function publicHolidayNames(year: number): Map<string, string> {
  const easter = easterSunday(year);
  const map = new Map<string, string>();
  map.set(iso(new Date(year, 0, 1)), "Neujahr");
  map.set(iso(addDays(easter, -2)), "Karfreitag");
  map.set(iso(addDays(easter, 1)), "Ostermontag");
  map.set(iso(new Date(year, 4, 1)), "Tag der Arbeit");
  map.set(iso(addDays(easter, 39)), "Christi Himmelfahrt");
  map.set(iso(addDays(easter, 50)), "Pfingstmontag");
  map.set(iso(new Date(year, 9, 3)), "Tag der Deutschen Einheit");
  map.set(iso(new Date(year, 9, 31)), "Reformationstag"); // Sachsen, 31.10.
  map.set(iso(bussUndBettag(year)), "Buß- und Bettag"); // Sachsen
  map.set(iso(new Date(year, 11, 25)), "1. Weihnachtstag");
  map.set(iso(new Date(year, 11, 26)), "2. Weihnachtstag");
  return map;
}

/**
 * Alle gesetzlichen Feiertage in Sachsen eines Jahres als ISO-Set
 * "yyyy-MM-dd". Leitet sich aus publicHolidayNames ab, damit Set und Namen
 * niemals auseinanderlaufen können.
 */
export function publicHolidays(year: number): Set<string> {
  return new Set(publicHolidayNames(year).keys());
}
