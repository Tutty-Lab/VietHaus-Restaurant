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
 * Pausenregel (Vorgabe des Chefs, VietHaus Restaurant):
 * „Das Lokal macht keine Pause, aber nach spätestens 4 Stunden muss die
 * Kraft eine Pause nehmen."
 *
 *   bis 4 h  -> keine Pause
 *   über 4 h -> 30 Minuten
 *   ab 9 h   -> 45 Minuten (gesetzliches Minimum nach ArbZG §4)
 *
 * Der Betrieb ist damit strenger als das Gesetz, das erst über 6 h eine Pause
 * verlangt – so gewollt.
 *
 * Die Pause kommt ZUSÄTZLICH zur bezahlten Zeit: presence = paid + pause.
 * Eine 9-h-Schicht belegt damit 9,75 h Anwesenheit und passt noch in das
 * Fenster 11:30–22:00 (10,5 h).
 *
 * Alle Zeit-/Schichtberechnungen leiten sich von dieser einen Funktion ab –
 * eine andere Pausenstaffel zu fahren betrifft nur diese Stelle.
 */
export function calculatePause(paidMinutes: number): number {
  if (paidMinutes >= 9 * 60) return 45;
  if (paidMinutes > 4 * 60) return 30;
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
