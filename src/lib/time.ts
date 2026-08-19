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
 * Pausenregel (Vorgabe des Chefs, VietHaus Restaurant): "Không có pause" –
 * es wird KEINE Pause von der Arbeitszeit abgezogen. Anwesenheit = bezahlte
 * Zeit, pauseMinutes ist immer 0.
 *
 * Hinweis: Damit steht auf dem Stundenzettel keine Pause. Das ist die Ansage
 * des Betriebs; das Arbeitszeitgesetz verlangt ab mehr als 6 Stunden an sich
 * 30 Minuten. Eine spätere Umstellung betrifft nur diese eine Funktion – alle
 * Zeit- und Schichtberechnungen leiten sich davon ab.
 */
export function calculatePause(_paidMinutes: number): number {
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
