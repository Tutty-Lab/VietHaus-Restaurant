// ============================================================================
// Reine Zeit-Hilfsfunktionen. Alles in Minuten seit Mitternacht (Integer).
// ============================================================================

/** "13:30" -> 810. Wirft bei ungültigem Format. */
export function timeToMinutes(time: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) {
    throw new Error(`Ungültiges Zeitformat: "${time}" (erwartet HH:mm)`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Ungültige Uhrzeit: "${time}"`);
  }
  return hours * 60 + minutes;
}

/** 810 -> "13:30". Immer zweistellig, 24h-Format. */
export function minutesToTime(totalMinutes: number): string {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Pausenregel. Angabe des Betriebs: über 6 Stunden 30 Minuten, ab 8 Stunden
 * 60 Minuten.
 *
 * Das ist GROSSZÜGIGER als das Gesetz. Das Arbeitszeitgesetz (§ 4 ArbZG, für
 * ganz Deutschland gleich, nicht je Bundesland verschieden) verlangt bei mehr
 * als 6 Stunden 30 Minuten und bei mehr als 9 Stunden 45 Minuten. Mehr Pause
 * zu geben ist erlaubt, weniger nicht – die Vorgabe liegt also auf der
 * sicheren Seite.
 *
 * Die Pause wird NICHT von der Arbeitszeit abgezogen, sondern verlängert die
 * Anwesenheit: presence = paid + pause. Eine 9-Stunden-Schicht belegt damit
 * 10 Stunden und passt noch in das Fenster 11:30-22:00 (10,5 h). Eine
 * 8-Stunden-Schicht belegt 9 Stunden.
 *
 * Einzige Stelle für diese Rechnung – alle Schicht- und Zeitberechnungen
 * leiten sich hier ab.
 */
export function calculatePause(paidMinutes: number): number {
  if (paidMinutes >= 8 * 60) return 60;
  if (paidMinutes > 6 * 60) return 30;
  return 0;
}

/**
 * Bezahlte Minuten aus Anwesenheit und Pause.
 * paidMinutes = presenceMinutes - pauseMinutes
 */
export function calculatePaidMinutes(
  startMinutes: number,
  endMinutes: number,
  pauseMinutes: number,
): number {
  return endMinutes - startMinutes - pauseMinutes;
}

/** Anwesenheit (inkl. Pause) aus bezahlter Zeit. */
export function presenceFromPaid(paidMinutes: number): number {
  return paidMinutes + calculatePause(paidMinutes);
}

/** Minuten -> Stunden als deutsche Dezimalzahl, z.B. 450 -> "7,50". */
export function minutesToDecimalHours(totalMinutes: number, fractionDigits = 2): string {
  const hours = totalMinutes / 60;
  return hours.toLocaleString("de-DE", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** Minuten -> kompakte Stundenangabe, z.B. 480 -> "8h", 450 -> "7,5h". */
export function minutesToShortHours(totalMinutes: number): string {
  const hours = totalMinutes / 60;
  const text = Number.isInteger(hours)
    ? String(hours)
    : hours.toLocaleString("de-DE", { maximumFractionDigits: 2 });
  return `${text}h`;
}
