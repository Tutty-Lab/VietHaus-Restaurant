// ============================================================================
// Deterministischer, greedy Scheduler (kein Solver, kein KI-Modell).
//
// Vorgehen:
//  1. Alle Tage des Monats + Nachfrage-Gewichte -> rohes Tages-Soll (Minuten).
//  2. Sollstunden jedes Mitarbeiters in Schicht-Token zerlegen.
//  3. Token rundenweise (rotierend) verteilen; große Vollzeit-Schichten zuerst.
//  4. Für jedes Token die beste Kalender-Datum wählen (Score + harte Regeln).
//  5. Früh/Spät anhand der gewünschten Spätschicht-Quote wählen.
//  6. Reparaturlauf: Schichten zwischen Tagen verschieben, um die Tages-
//     nachfrage besser zu treffen (Sollstunden bleiben exakt erhalten).
//
// Harte Regeln, die IMMER eingehalten werden:
//  - genau ein Dienst pro Mitarbeiter und Tag
//  - höchstens 6 aufeinanderfolgende Arbeitstage
//  - Token-Dauer wird nie verändert  => monatliches Soll bleibt exakt
// ============================================================================

import type { Employee, Shift } from "../types";
import {
  DAY_WEIGHTS,
  LATE_SHIFT_RATIOS,
  datesOfMonth,
  parseIsoDate,
  weekdayKeyOf,
  type WeekdayKey,
} from "./demand";
import { getShiftTemplate, type TemplateType } from "./shifts";
import { consecutiveRunLengthWith, seededRandom } from "./consecutive";
import { presenceFromPaid } from "./time";
import {
  effectiveWeekdayKey,
  resolveDay,
  type DayWindow,
  type ResolvedDay,
  type OverrideMap,
  type WorkHoursConfig,
} from "./workHours";
import { publicHolidays } from "./holidays";

export type GenerateInput = {
  year: number;
  month: number; // 1-basiert
  /** Arbeitszeit-Fenster je Wochentag + Feiertag. */
  workHours: WorkHoursConfig;
  /** Ausnahmen für einzelne Daten (geschlossen / abweichende Zeiten). */
  overrides?: OverrideMap;
  employees: Employee[];
  /** Feiertage als ISO-Set; Standard: Sachsen-Feiertage des Jahres. */
  holidays?: Set<string>;
  /** Optionaler Seed; sonst aus Eingabedaten abgeleitet. */
  seed?: string;
};

type DateState = {
  totalPaid: number;
  latePaid: number;
  count: number;
};

type SchedulerState = {
  dates: string[];
  rawTarget: Map<string, number>; // ISO -> rohes Tages-Soll in Minuten
  dateState: Map<string, DateState>;
  worked: Map<string, Set<string>>; // employeeId -> Set<ISO>
  weekendCount: Map<string, number>; // employeeId -> Anzahl Fr/Sa-Schichten
  remaining: Map<string, number>; // employeeId -> noch zu verplanende Minuten
  shifts: Shift[];
  /** Für Nachfrage/Spätquote maßgeblicher Wochentag (Feiertag = Sonntag). */
  effKeyOf: (isoDate: string) => WeekdayKey;
  /** Aufgelöster Tag (geschlossen? + Arbeitszeit-Fenster) für ein Datum. */
  dayOf: (isoDate: string) => ResolvedDay;
  rng: () => number;
  /** true = Schichtlängen mischen; false = immer die längste (Rückfallmodus). */
  varyLengths: boolean;
};

/** Länge des Zeitfensters in Minuten (0 wenn geschlossen). */
function windowLength(day: ResolvedDay): number {
  return day.closed ? 0 : day.window.endMinutes - day.window.startMinutes;
}

let shiftIdCounter = 0;
function nextShiftId(): string {
  shiftIdCounter += 1;
  return `gen-${shiftIdCounter}`;
}

function isWeekend(isoDate: string): boolean {
  const key = weekdayKeyOf(parseIsoDate(isoDate));
  return key === "friday" || key === "saturday";
}

const SHIFT_HOURS_DESC = [9, 8, 7, 6, 5, 4, 3] as const;

/** Längste zulässige Schicht in Stunden (bezahlt, ohne Pause). */
const MAX_SHIFT_HOURS = 9;

/** Kürzeste zulässige Schicht in Minuten – darunter geht ein Soll nicht auf. */
const MIN_SHIFT_MINUTES = 3 * 60;

/**
 * Erlaubte Schichtlängen je Anstellungsart (Vorgabe des Chefs).
 *
 * Vollzeit macht lange Dienste (6..9 h), Teilzeit die volle Bandbreite.
 *
 * Es gab zwischenzeitlich ein Kurzschicht-Budget, das einen langen Dienst
 * gelegentlich durch zwei kurze ersetzt hat (8 h -> 4 h + 4 h), damit die
 * Pläne abwechslungsreicher aussehen. Das ist wieder draußen: der Laden hat
 * drei Beschäftigte, da soll der Plan bewusst gleichförmig bleiben. Jede
 * Abwechslung kostet hier Besetzung in der Stoßzeit.
 */
const ALLOWED_HOURS: Record<Employee["employmentType"], readonly number[]> = {
  VOLLZEIT: [4, 5, 6, 7, 8, 9],
  TEILZEIT: [3, 4, 5, 6, 7, 8, 9],
  // Minijob ist arbeitsrechtlich eine Form der Teilzeit – gleiche Längen.
  // Begrenzt wird er über das Monats-Soll, nicht über die Schichtlänge.
  MINIJOB: [3, 4, 5, 6, 7, 8, 9],
};

/**
 * Wie oft darf eine Schicht bewusst kurz ausfallen (4 oder 5 h)?
 *
 * Vorgabe des Chefs: „nur etwa jede zehnte". Ganz ohne kurze Dienste sieht
 * jeder Monat gleich aus; zu viele davon kosten Besetzung in der Stoßzeit.
 * Greift nur, wenn der Tag ohnehin keinen langen Dienst mehr braucht und
 * genügend Reservetage übrig sind – das Monats-Soll bleibt in jedem Fall exakt.
 */
const SHORT_SHIFT_CHANCE = 0.1;

/** Längen, die als „kurze Schicht" im Sinne der 10-%-Regel gelten. */
const SHORT_SHIFT_HOURS: readonly number[] = [4, 5];

/** Alle überhaupt zulässigen Längen – Rückfall, wenn das Fenster eng ist. */
const ALL_HOURS: readonly number[] = [3, 4, 5, 6, 7, 8, 9];

// ── Stoßzeiten (peak windows) ───────────────────────────────────────────────
// Vorgabe des Chefs: mittags 12–13 Uhr und abends 17–19 Uhr müssen JEDERZEIT
// mindestens zwei Leute im Laden stehen – nicht nur an einem Messpunkt,
// sondern über die ganze Spanne.
export type PeakWindow = {
  label: string;
  startMinutes: number;
  endMinutes: number;
  minStaff: number;
};

export const PEAK_WINDOWS: readonly PeakWindow[] = [
  // ANNAHME, vom Chef noch zu bestätigen: VietHaus ist ein Restaurant mit
  // Abendgeschäft, die Spitze liegt deshalb abends. Vorgegeben war bisher nur
  // „voll am Wochenende" – über die Uhrzeit wurde nichts gesagt. Falls die
  // Mittagszeit ebenfalls doppelt besetzt sein soll, kommt hier eine zweite
  // Zeile dazu; alles andere passt sich automatisch an.
  { label: "Abend", startMinutes: 18 * 60, endMinutes: 21 * 60, minStaff: 2 },
];

/** Wie viele Leute sind zum Zeitpunkt `t` anwesend (Anwesenheit inkl. Pause)? */
function coverageAt(shifts: Shift[], t: number): number {
  let n = 0;
  for (const s of shifts) if (s.startMinutes <= t && s.endMinutes > t) n++;
  return n;
}

/**
 * Kleinste Besetzung im halboffenen Intervall [from, to).
 * Die Besetzung ändert sich nur an Schichtgrenzen, deshalb genügt es, den
 * Anfang und jede Grenze innerhalb des Intervalls zu prüfen.
 */
export function minCoverageOver(shifts: Shift[], from: number, to: number): number {
  const probes = new Set<number>([from]);
  for (const s of shifts) {
    if (s.startMinutes > from && s.startMinutes < to) probes.add(s.startMinutes);
    if (s.endMinutes > from && s.endMinutes < to) probes.add(s.endMinutes);
  }
  let min = Number.POSITIVE_INFINITY;
  for (const t of probes) min = Math.min(min, coverageAt(shifts, t));
  return Number.isFinite(min) ? min : 0;
}

/**
 * Wie viele Personen fehlen an diesem Tag über alle Stoßzeiten zusammen?
 * 0 = beide Spitzen sind ausreichend besetzt. Spitzen, die gar nicht ins
 * Arbeitszeit-Fenster fallen, zählen nicht mit.
 */
export function peakDeficit(shifts: Shift[], window: { startMinutes: number; endMinutes: number }): number {
  let deficit = 0;
  for (const peak of PEAK_WINDOWS) {
    const from = Math.max(peak.startMinutes, window.startMinutes);
    const to = Math.min(peak.endMinutes, window.endMinutes);
    if (to <= from) continue; // Spitze liegt außerhalb der Arbeitszeit
    deficit += Math.max(0, peak.minStaff - minCoverageOver(shifts, from, to));
  }
  return deficit;
}

/**
 * Lässt sich `hours` restlos in Schichten aus `allowed` zerlegen?
 * Nötig, weil z.B. 11 h mit nur 6/7/8-h-Schichten nicht aufgeht – ohne diese
 * Prüfung liefe der Scheduler in eine Sackgasse und das Soll bliebe offen.
 */
const decomposeCache = new Map<string, boolean>();
function canDecompose(hours: number, allowed: readonly number[]): boolean {
  if (hours === 0) return true;
  if (hours < Math.min(...allowed)) return false;

  // Schlüssel über die WERTE, nicht die Länge: zwei verschiedene Längenmengen
  // mit gleich vielen Einträgen hätten sonst denselben Cache-Eintrag.
  const key = `${allowed.join(",")}:${hours}`;
  const cached = decomposeCache.get(key);
  if (cached !== undefined) return cached;

  let ok = false;
  for (const h of allowed) {
    if (canDecompose(hours - h, allowed)) {
      ok = true;
      break;
    }
  }
  decomposeCache.set(key, ok);
  return ok;
}

/** Längstmögliche Schicht je Anstellungsart – für die Kapazitätsrechnung. */
const PREFERRED_HOURS: Record<Employee["employmentType"], number> = {
  VOLLZEIT: MAX_SHIFT_HOURS,
  TEILZEIT: MAX_SHIFT_HOURS,
  MINIJOB: MAX_SHIFT_HOURS,
};

/** Größte Schichtlänge (Stunden), deren Anwesenheit noch ins Fenster passt (0 = keine). */
export function maxShiftHoursForWindow(windowMinutes: number): number {
  for (const hours of SHIFT_HOURS_DESC) {
    if (presenceFromPaid(hours * 60) <= windowMinutes) return hours;
  }
  return 0;
}

/**
 * Kürzeste Schichtlänge (Stunden), deren Anwesenheit mindestens `presence`
 * Minuten abdeckt. 0 = selbst die längste Schicht reicht nicht.
 */
export function shiftHoursForPresence(presenceMinutes: number): number {
  for (let i = SHIFT_HOURS_DESC.length - 1; i >= 0; i--) {
    const hours = SHIFT_HOURS_DESC[i];
    if (presenceFromPaid(hours * 60) >= presenceMinutes) return hours;
  }
  return 0;
}

/**
 * Wie viele bezahlte Minuten braucht ein Tag mindestens, damit die Stoßzeit
 * überhaupt besetzt werden KANN?
 *
 * Hintergrund: Früh hängt am Öffnen, Spät am Schließen. Eine Frühschicht deckt
 * die Stoßzeit nur, wenn sie bis zu deren Ende reicht; eine Spätschicht nur,
 * wenn sie vor deren Beginn anfängt. Bei 10:00–20:00 und einer Stoßzeit von
 * 12 bis 18 Uhr heißt das: beide brauchen 8 h Anwesenheitsspanne, also je eine
 * 8-h-Schicht. Zwei Personen => 16 h an dem Tag.
 *
 * Ohne diesen Boden verteilt die Gewichtung ruhigen Tagen so wenig Stunden,
 * dass dort nur kurze Dienste möglich sind – und die decken die Stoßzeit nie,
 * egal wie man sie schiebt.
 */
function peakFloorMinutes(day: ResolvedDay): number {
  if (day.closed) return 0;
  return cheapestPeakCover(day.window).reduce((sum, h) => sum + h * 60, 0);
}

const coverCache = new Map<string, number[]>();

/**
 * Billigste Kombination von Schichtlängen, mit der ein Tag ALLES erfüllt:
 * jemand sperrt auf, jemand sperrt zu, und die Stoßzeit ist durchgehend
 * besetzt. Ergebnis in Stunden, absteigend. Leer = gar nicht abdeckbar.
 *
 * Warum gesucht statt gerechnet: die naheliegende Formel „jeder Dienst muss
 * vom Öffnen bis zum Ende der Stoßzeit reichen" ergibt bei 10–20 Uhr und
 * Stoßzeit 12–18 Uhr zweimal 8 h = 16 h. Billiger geht es aber mit 9 h + 6 h
 * = 15 h: der 9-h-Dienst füllt das ganze Fenster und erledigt Aufsperren,
 * Zusperren und Stoßzeit in einem, der 6-h-Dienst stellt sich einfach mitten
 * hinein. Solche Kombinationen findet man nur, wenn man sie durchprobiert –
 * und zwar mit derselben Anordnungslogik, die später auch real läuft.
 */
export function cheapestPeakCover(window: DayWindow): number[] {
  const key = `${window.startMinutes}-${window.endMinutes}`;
  const cached = coverCache.get(key);
  if (cached) return cached;

  const span = window.endMinutes - window.startMinutes;
  const usable = ALL_HOURS.filter((h) => presenceFromPaid(h * 60) <= span);

  let found: number[] = [];
  // Nach Anzahl der Dienste aufsteigend, innerhalb nach Gesamtstunden.
  for (let count = 1; count <= 4 && found.length === 0; count++) {
    let bestTotal = Number.POSITIVE_INFINITY;
    let best: number[] | null = null;
    const combo: number[] = [];

    const recurse = (from: number) => {
      if (combo.length === count) {
        const total = combo.reduce((a, b) => a + b, 0);
        if (total < bestTotal && canCoverDay(window, combo)) {
          bestTotal = total;
          best = [...combo];
        }
        return;
      }
      for (let i = from; i < usable.length; i++) {
        combo.push(usable[i]);
        recurse(i); // Wiederholungen erlaubt
        combo.pop();
      }
    };
    recurse(0);

    if (best) found = (best as number[]).slice().sort((a, b) => b - a);
  }

  coverCache.set(key, found);
  return found;
}

/** Lässt sich der Tag mit genau diesen Längen vollständig abdecken? */
function canCoverDay(window: DayWindow, hours: number[]): boolean {
  const probe: Shift[] = hours.map((h, i) => ({
    id: `probe-${i}`,
    employeeId: `probe-${i}`,
    date: "probe",
    startMinutes: window.startMinutes,
    endMinutes: window.startMinutes + presenceFromPaid(h * 60),
    pauseMinutes: h * 60 - h * 60 + (presenceFromPaid(h * 60) - h * 60),
    paidMinutes: h * 60,
    shiftType: "EARLY",
    generated: true,
  }));

  arrangeForPeaks(window, probe);

  const opens = probe.some((s) => s.startMinutes === window.startMinutes);
  const closes = probe.some((s) => s.endMinutes === window.endMinutes);
  return opens && closes && peakDeficit(probe, window) === 0;
}

/** Bezahlte Stunden aller Dienste eines Tages. */
function dayPaidHours(state: SchedulerState, isoDate: string): number[] {
  const out: number[] = [];
  for (const s of state.shifts) if (s.date === isoDate) out.push(s.paidMinutes / 60);
  return out;
}

/**
 * Wie viele Anforderungen der billigsten Abdeckung deckt diese Menge von
 * Schichtlängen ab? Lange Dienste werden zuerst auf die größte offene
 * Anforderung gelegt.
 */
function coverFilledBy(cover: readonly number[], hours: number[]): number {
  const need = [...cover];
  let filled = 0;
  for (const h of [...hours].sort((a, b) => b - a)) {
    const idx = need.findIndex((n) => h >= n);
    if (idx >= 0) {
      need.splice(idx, 1);
      filled++;
    }
  }
  return filled;
}

/** Abdeckung eines Tages, wenn er GENAU diese Schichtlängen hätte. */
function coverFilledFor(state: SchedulerState, isoDate: string, hours: number[]): number {
  const day = state.dayOf(isoDate);
  if (day.closed) return Number.POSITIVE_INFINITY;
  const cover = cheapestPeakCover(day.window);
  if (cover.length === 0) return Number.POSITIVE_INFINITY;
  return coverFilledBy(cover, hours);
}

/** Wie viele Dienste verlangt die billigste Abdeckung an diesem Tag? */
function coverSize(state: SchedulerState, isoDate: string): number {
  const day = state.dayOf(isoDate);
  if (day.closed) return 0;
  return cheapestPeakCover(day.window).length;
}

/**
 * Welche Länge fehlt diesem Tag noch, um die billigste Abdeckung zu erreichen?
 * 0 = der Tag hat schon genug passende Dienste.
 */
function missingCoverHours(state: SchedulerState, isoDate: string): number {
  const day = state.dayOf(isoDate);
  if (day.closed) return 0;
  const need = [...cheapestPeakCover(day.window)];
  if (need.length === 0) return 0;

  for (const h of dayPaidHours(state, isoDate).sort((a, b) => b - a)) {
    const idx = need.findIndex((n) => h >= n);
    if (idx >= 0) need.splice(idx, 1);
  }
  return need.length === 0 ? 0 : Math.max(...need);
}

/**
 * Wählt die Länge (Stunden) der nächsten Schicht eines Mitarbeiters so, dass
 * - sie 3..9 h ist und ins Tagesfenster passt (<= maxHours),
 * - der verbleibende Rest exakt aufteilbar bleibt (0 oder >= 3 h),
 * - Vollzeit möglichst lange, Teilzeit eher kürzere Schichten bekommt.
 * Gibt 0 zurück, wenn an diesem Tag keine gültige Länge möglich ist.
 *
 * Dadurch arbeiten auch Vollzeit-Kräfte an einem „halben Tag" – nur mit einer
 * kürzeren Schicht – und das Monats-Soll bleibt trotzdem exakt.
 */
export function chooseShiftHours(
  remainingMinutes: number,
  maxHours: number,
  employmentType: Employee["employmentType"],
  /** Mindestlänge, um das Soll bis Monatsende noch zu schaffen (Stunden). */
  needHours = MAX_SHIFT_HOURS,
  /** Ohne Zufallsquelle wird deterministisch die kürzeste taugliche gewählt. */
  rng?: () => number,
  /**
   * Länge (Stunden), ab der ein Dienst die Stoßzeit decken kann. > 0 heißt:
   * dieser Tag braucht noch so einen Dienst.
   */
  peakHours = 0,
): number {
  const remainingHours = remainingMinutes / 60;
  const cap = Math.min(MAX_SHIFT_HOURS, maxHours, remainingHours);
  if (cap < 3) return 0;

  // Erlaubte Längen je Anstellungsart (Vorgabe des Chefs): Vollzeit macht keine
  // Kurzschichten, Teilzeit darf die ganze Bandbreite.
  const pick = (allowed: readonly number[]): number[] => {
    const out: number[] = [];
    for (const hours of allowed) {
      if (hours > cap) continue;
      // Der Rest muss mit denselben Längen restlos aufgehen. Bei Vollzeit
      // (6/7/8) sind z.B. 9, 10, 11 oder 17 Stunden Sackgassen.
      if (canDecompose(remainingHours - hours, allowed)) out.push(hours);
    }
    return out;
  };

  // Früher entschied eine feste Rangliste (Vollzeit 8, Teilzeit 5). Ergebnis:
  // jede Vollzeitschicht war 8 h, jede Teilzeitschicht 5 h – keinerlei
  // Abwechslung, und Teilzeit war faktisch auf 5 h/Tag gedeckelt.
  //
  // Jetzt: unter allen Längen zufällig wählen, aber nur solche, die das Tempo
  // halten. Wer noch viel Soll und wenig Tage hat, bekommt zwangsläufig lange
  // Schichten; wer gut liegt, bekommt Abwechslung.
  const choose = (valid: number[]): number => {
    const onPace = valid.filter((h) => h >= needHours).sort((a, b) => a - b);
    if (onPace.length === 0) return valid[valid.length - 1];

    // Ohne Zufallsquelle läuft der strenge Rückfallversuch (attempt(false)).
    // Dort zählt nur noch, dass das Soll überhaupt aufgeht: die LÄNGSTE Länge
    // braucht die wenigsten Tage und hat deshalb die besten Chancen.
    //
    // Diese Unterscheidung ist der eigentliche Sinn des Rückfalls. Fehlte sie,
    // verhielte sich der strenge Versuch exakt wie die vorherigen fünf – das
    // Sicherheitsnetz wäre keins mehr. Genau daran scheiterte der Plan bei
    // einem Laden, der SIEBEN Tage offen hat: dort erzwingt die Sechs-Tage-
    // Regel Lücken, das Soll geht knapp nicht auf, und ohne den Rückfall gab
    // es gar keinen Plan.
    if (!rng) return onPace[onPace.length - 1];

    // Im Normalfall die KÜRZESTE Länge, die das Tempo noch hält.
    //
    // needHours ist bereits das Mittel, das nötig ist, um das Soll bis
    // Monatsende genau aufzubrauchen. Wer länger arbeitet als dieses Mittel,
    // ist vorzeitig fertig – und steht dem Laden die restlichen Tage nicht
    // mehr zur Verfügung. Bei kleinen Deputaten fällt das brutal auf: 43 h in
    // 9-h-Diensten sind nach fünf Tagen weg, in 5-h-Diensten reichen sie für
    // neun.
    return onPace[0];
  };

  // Braucht der Tag noch einen stoßzeittauglichen Dienst, wird zuerst NUR mit
  // den langen Längen gerechnet – und zwar auch für den Rest. Ohne diese
  // zweite Bedingung bleibt am Monatsende ein Rest übrig, der sich nicht mehr
  // in lange Dienste zerlegen lässt (z.B. 13 h), und genau dort entstehen die
  // kurzen Schichten, die eine Stoßzeit nie decken können.
  if (peakHours > 0) {
    const longOnly = ALLOWED_HOURS[employmentType].filter((h) => h >= peakHours);
    const validLong = pick(longOnly);
    if (validLong.length > 0) return choose(validLong);
  }

  // Braucht der Tag keinen langen Dienst mehr, darf etwa jede zehnte Schicht
  // bewusst kurz ausfallen – nur dann bleibt der Rest auch aufteilbar.
  if (rng && peakHours === 0 && rng() < SHORT_SHIFT_CHANCE) {
    const shortValid = pick(
      ALLOWED_HOURS[employmentType].filter((h) => SHORT_SHIFT_HOURS.includes(h)),
    );
    if (shortValid.length > 0) return shortValid[Math.floor(rng() * shortValid.length)];
  }

  // Erst die für die Anstellungsart vorgesehenen Längen. Geht dort nichts –
  // etwa an einem halben Tag, an dem keine 6-h-Schicht mehr hineinpasst –
  // greift die volle Bandbreite, damit auch Vollzeit an dem Tag arbeiten kann.
  let valid = pick(ALLOWED_HOURS[employmentType]);
  if (valid.length === 0) valid = pick(ALL_HOURS);
  if (valid.length === 0) return 0;

  return choose(valid);
}

/** Stabile Basisordnung: Vollzeit zuerst, dann nach Id. */
function orderedEmployees(employees: Employee[]): Employee[] {
  return [...employees].sort((a, b) => {
    if (a.employmentType !== b.employmentType) {
      return a.employmentType === "VOLLZEIT" ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });
}

function chooseTemplateType(
  state: SchedulerState,
  isoDate: string,
  employmentType: Employee["employmentType"],
): TemplateType {
  const ds = state.dateState.get(isoDate)!;
  const effKey = state.effKeyOf(isoDate);
  const desired = LATE_SHIFT_RATIOS[effKey];
  const currentLateRatio = ds.totalPaid > 0 ? ds.latePaid / ds.totalPaid : 0;

  // Teilzeit tendenziell in Spätschichten. Früher wurde sonntags zusätzlich
  // auf 0,95 hochgezwungen – damit stand am Sonntag praktisch niemand zur
  // Öffnung um 11:00 im Laden. Jetzt gilt die konfigurierte Quote.
  let threshold = desired;
  if (employmentType !== "VOLLZEIT") threshold += 0.15;

  return currentLateRatio < threshold ? "LATE" : "EARLY";
}

function makeShift(
  state: SchedulerState,
  employee: Employee,
  isoDate: string,
  paidMinutes: number,
): Shift {
  const type = chooseTemplateType(state, isoDate, employee.employmentType);
  const win = state.dayOf(isoDate).window;
  const tpl = getShiftTemplate(paidMinutes / 60, type, win.startMinutes, win.endMinutes);
  return {
    id: nextShiftId(),
    employeeId: employee.id,
    date: isoDate,
    startMinutes: tpl.startMinutes,
    endMinutes: tpl.endMinutes,
    pauseMinutes: tpl.pauseMinutes,
    paidMinutes: tpl.paidMinutes,
    shiftType: tpl.type,
    generated: true,
  };
}

function applyShift(state: SchedulerState, shift: Shift): void {
  const ds = state.dateState.get(shift.date)!;
  ds.totalPaid += shift.paidMinutes;
  if (shift.shiftType === "LATE") ds.latePaid += shift.paidMinutes;
  ds.count += 1;
  state.worked.get(shift.employeeId)!.add(shift.date);
  if (isWeekend(shift.date)) {
    state.weekendCount.set(
      shift.employeeId,
      (state.weekendCount.get(shift.employeeId) ?? 0) + 1,
    );
  }
  state.shifts.push(shift);
}

/**
 * Platziert genau eine Schicht für einen Mitarbeiter: bestes Datum wählen,
 * Schichtlänge an das Tagesfenster anpassen. Gibt true zurück, wenn platziert.
 */
function placeOneShift(state: SchedulerState, employee: Employee): boolean {
  const remaining = state.remaining.get(employee.id)!;
  if (remaining <= 0) return false;

  const worked = state.worked.get(employee.id)!;
  const weekendCount = state.weekendCount.get(employee.id) ?? 0;

  // Wie viele Tage kann dieser Mitarbeiter ab jetzt WIRKLICH noch arbeiten?
  //
  // Greedy von vorn durchspielen und dabei die Sechs-Tage-Regel mitführen –
  // dieselbe Rechnung wie in monthCapacity, nur für diese Person und ihren
  // aktuellen Stand. Das Ergebnis ist eine echte Obergrenze, kein Schätzwert.
  //
  // Vorher stand hier `daysLeft * 0.9`, ein pauschaler Sicherheitsabschlag von
  // zehn Prozent. Der reicht, solange der Laden einen festen Ruhetag hat: der
  // geschlossene Tag unterbricht die Kette, und fast jeder offene Tag bleibt
  // belegbar. Hat der Laden gar keinen Ruhetag, sind es aber höchstens sechs
  // von je sieben Tagen, also 85,7 Prozent – die Schätzung war zu optimistisch,
  // das Tempo dadurch zu langsam, und am Monatsende blieben Stunden übrig, für
  // die es keinen zulässigen Tag mehr gab. Der Plan scheiterte dann komplett.
  let usableDays = 0;
  const trial = new Set(worked);
  for (const isoDate of state.dates) {
    if (trial.has(isoDate)) continue;
    const day = state.dayOf(isoDate);
    if (day.closed) continue;
    if (maxShiftHoursForWindow(windowLength(day)) === 0) continue;
    if (consecutiveRunLengthWith(trial, isoDate) > 6) continue;
    trial.add(isoDate); // belegt – zählt für die Kette der folgenden Tage mit
    usableDays += 1;
  }

  const needHours =
    usableDays > 0 ? Math.ceil(remaining / 60 / usableDays) : MAX_SHIFT_HOURS;

  let bestDate: string | null = null;
  let bestHours = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const isoDate of state.dates) {
    if (worked.has(isoDate)) continue; // max. ein Dienst pro Tag
    const day = state.dayOf(isoDate);
    if (day.closed) continue; // Betriebsruhe -> kein Dienst

    const dsNow = state.dateState.get(isoDate)!;
    const wanted = coverSize(state, isoDate); // wie viele Leute der Tag braucht
    const bodiesMissing = Math.max(0, wanted - dsNow.count);

    // Längste Schicht, die ins Fenster passt UND den Rest exakt aufteilbar lässt.
    let maxHours = maxShiftHoursForWindow(windowLength(day));

    // Reichen die Stunden des Tages nicht für die volle Abdeckung, ist ZWEI
    // Personen wichtiger als eine lange. Vorher entstanden reihenweise Tage
    // mit einer einzigen 9-h-Schicht von 10 bis 20 Uhr: die Person steht den
    // ganzen Tag allein im Laden, und während ihrer Pause ist niemand da.
    // Deshalb die Länge so deckeln, dass für die fehlenden Personen noch
    // Stunden des Tages übrig bleiben.
    if (bodiesMissing > 1) {
      const leftHours = (state.rawTarget.get(isoDate)! - dsNow.totalPaid) / 60;
      const share = Math.floor(leftHours / bodiesMissing);
      // Der Deckel darf das EIGENE Tempo nie unterschreiten. Sonst macht er
      // den Monat unplanbar: braucht ein Tag drei Dienste (bei 11:30-22:00 und
      // einer Abendspitze schafft keine einzelne Schicht beides, Öffnen und
      // 21 Uhr), dann ist ein Drittel der Tagesstunden schnell weniger, als die
      // Kraft im Schnitt pro Tag braucht - und ihr Soll geht nie auf.
      const limit = Math.max(share, needHours);
      if (limit >= 3) maxHours = Math.min(maxHours, limit);
    }

    // Solange der Tag noch nicht genug LANGE Dienste hat, um die Stoßzeit zu
    // decken, wird die Mindestlänge hochgezogen. Ohne das entstehen Tage mit
    // rechnerisch genug Stunden, aber falscher Aufteilung (16 h als 7 + 9),
    // und die Stoßzeit bleibt unbesetzt – verschieben hilft dann nicht mehr.
    //
    // ABER nur, wenn der Tag sich die Abdeckung überhaupt leisten kann. Sonst
    // erzwingt die Regel eine Form, die nie aufgeht, und richtet Schaden an:
    // die billigste Abdeckung ist 9 h + 6 h, also verlangte JEDER leere Tag
    // zuerst einen 9-h-Dienst. Bei 26 Tagen sind das 234 h allein dafür – bei
    // 317 h Gesamtsoll bleibt für die zweite Person kaum etwas übrig, und eine
    // Teilzeitkraft mit 55 h ist nach sechs Diensten durch.
    const coverHours = cheapestPeakCover(day.window).reduce((sum, h) => sum + h, 0);
    const dayTargetHours = state.rawTarget.get(isoDate)! / 60;
    const affordsCover = coverHours > 0 && dayTargetHours >= coverHours - 0.5;
    const stillNeedsLong = affordsCover
      ? Math.min(missingCoverHours(state, isoDate), maxHours)
      : 0;

    const hours = chooseShiftHours(
      remaining,
      maxHours,
      employee.employmentType,
      stillNeedsLong > 0 ? Math.max(needHours, stillNeedsLong) : needHours,
      state.varyLengths ? state.rng : undefined,
      stillNeedsLong,
    );
    if (hours === 0) continue; // hier passt keine gültige Schicht

    // Harte Regel. Früher gab es hier einen Ausweichtag, der diese Prüfung
    // übersprungen hat – dabei entstanden lautlos Pläne mit bis zu 28
    // Arbeitstagen am Stück. Lieber gar keinen Plan als einen unzulässigen:
    // ohne gültigen Tag bleibt das Soll offen und generateSchedule wirft.
    const runLength = consecutiveRunLengthWith(worked, isoDate);
    if (runLength > 6) continue;

    const ds = state.dateState.get(isoDate)!;
    const deficitHours = (state.rawTarget.get(isoDate)! - ds.totalPaid) / 60;
    const dayWeight = DAY_WEIGHTS[state.effKeyOf(isoDate)];

    // Ein Tag ohne zweite Person wiegt schwerer als ein Tag, dem nur noch
    // Stunden fehlen. Ohne diesen Bonus jagt der Scheduler nur der Stundenzahl
    // hinterher und lässt halbe Monate mit Ein-Personen-Tagen zurück.
    const staffingBonus = bodiesMissing * 15;

    // Der Tag braucht noch einen langen Dienst, dieser hier ist aber zu kurz:
    // dann soll er lieber woanders hin und der Tag auf jemanden warten, der
    // die Länge liefern kann. Ohne das füllt der erste beste Kurzdienst die
    // Stunden des Tages auf und die Stoßzeit ist nicht mehr zu retten.
    const shapePenalty = stillNeedsLong > 0 && hours < stillNeedsLong ? 12 : 0;

    const consecutivePenalty = runLength >= 5 ? (runLength - 4) * 8 : 0;
    const weekendPenalty = isWeekend(isoDate) ? weekendCount * 1.5 : 0;

    const jitter = state.rng() * 0.01; // deterministisch (seeded), nur Tie-Break

    const score =
      deficitHours * 10 +
      staffingBonus +
      dayWeight * 3 -
      shapePenalty -
      consecutivePenalty -
      weekendPenalty +
      jitter;

    if (score > bestScore) {
      bestScore = score;
      bestDate = isoDate;
      bestHours = hours;
    }
  }

  if (bestDate === null || bestHours === 0) return false;

  const shift = makeShift(state, employee, bestDate, bestHours * 60);
  applyShift(state, shift);
  state.remaining.set(employee.id, remaining - shift.paidMinutes);
  return true;
}

/**
 * Darf sich die Abdeckung eines Tages so verändern?
 *
 * Erlaubt ist alles, was die geforderte Abdeckung weiter trägt – und bei
 * Tagen, die sie ohnehin nicht erreichen, alles, was nichts verschlimmert.
 * Ohne diese Schranke räumt der Reparaturlauf die Stoßzeit wieder ab: er
 * optimiert nur die Tagesstunden und schiebt fröhlich einen zu kurzen Dienst
 * auf einen Tag, der die Länge braucht.
 */
function peakCapacityOk(required: number, oldCount: number, newCount: number): boolean {
  return newCount >= Math.min(required, oldCount);
}

/** Kosten eines Tages = |zugewiesene - rohe Soll-Minuten|. */
function dateCost(state: SchedulerState, isoDate: string): number {
  return Math.abs(
    state.dateState.get(isoDate)!.totalPaid - state.rawTarget.get(isoDate)!,
  );
}

function removeShift(state: SchedulerState, shift: Shift): void {
  const ds = state.dateState.get(shift.date)!;
  ds.totalPaid -= shift.paidMinutes;
  if (shift.shiftType === "LATE") ds.latePaid -= shift.paidMinutes;
  ds.count -= 1;
  state.worked.get(shift.employeeId)!.delete(shift.date);
  if (isWeekend(shift.date)) {
    state.weekendCount.set(
      shift.employeeId,
      (state.weekendCount.get(shift.employeeId) ?? 0) - 1,
    );
  }
  const idx = state.shifts.indexOf(shift);
  // Ohne diese Prüfung würde splice(-1, 1) die LETZTE Schicht löschen und das
  // Monats-Soll lautlos reißen.
  if (idx < 0) {
    throw new Error("removeShift: Schicht ist nicht (mehr) im Plan");
  }
  state.shifts.splice(idx, 1);
}

/**
 * Reparaturlauf: verschiebt einzelne Schichten auf andere Tage, wenn dadurch
 * die Tagesnachfrage besser getroffen wird. Ändert nie die Dauer eines Tokens
 * und verletzt nie die harten Regeln => Sollstunden bleiben exakt erhalten.
 */
function repairDemand(state: SchedulerState, employeesById: Map<string, Employee>): void {
  const MAX_PASSES = 6;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false;
    // Kopie, da wir state.shifts während der Iteration verändern.
    for (const shift of [...state.shifts]) {
      const employee = employeesById.get(shift.employeeId)!;
      const from = shift.date;
      const worked = state.worked.get(employee.id)!;

      let bestTarget: string | null = null;
      let bestDelta = -1e-6; // nur echte Verbesserungen

      const oldCostFrom = dateCost(state, from);

      const presence = presenceFromPaid(shift.paidMinutes);
      for (const to of state.dates) {
        if (to === from || worked.has(to)) continue;
        const day = state.dayOf(to);
        if (day.closed || windowLength(day) < presence) continue; // geschlossen / passt nicht
        // 6-Tage-Regel prüfen, als ob "from" bereits entfernt wäre.
        const trial = new Set(worked);
        trial.delete(from);
        if (consecutiveRunLengthWith(trial, to) > 6) continue;

        // Die Stoßzeit darf durch einen Umzug nicht schlechter besetzbar werden.
        const hoursFrom = dayPaidHours(state, from);
        const hoursTo = dayPaidHours(state, to);
        const moved = shift.paidMinutes / 60;
        const withoutMoved = hoursFrom.filter((_, i) => i !== hoursFrom.indexOf(moved));
        if (
          !peakCapacityOk(
            coverSize(state, from),
            coverFilledFor(state, from, hoursFrom),
            coverFilledFor(state, from, withoutMoved),
          )
        ) {
          continue;
        }
        if (
          !peakCapacityOk(
            coverSize(state, to),
            coverFilledFor(state, to, hoursTo),
            coverFilledFor(state, to, [...hoursTo, moved]),
          )
        ) {
          continue;
        }

        const oldCostTo = dateCost(state, to);
        const newCostFrom = Math.abs(
          state.dateState.get(from)!.totalPaid - shift.paidMinutes - state.rawTarget.get(from)!,
        );
        const newCostTo = Math.abs(
          state.dateState.get(to)!.totalPaid + shift.paidMinutes - state.rawTarget.get(to)!,
        );
        const delta = newCostFrom + newCostTo - (oldCostFrom + oldCostTo);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestTarget = to;
        }
      }

      if (bestTarget) {
        removeShift(state, shift);
        applyShift(state, makeShift(state, employee, bestTarget, shift.paidMinutes));
        improved = true;
      }
    }
    if (trySwaps(state, employeesById)) improved = true;
    if (!improved) break;
  }
}

/**
 * Tauscht zwei Schichten zwischen zwei Tagen (verschiedene Mitarbeiter).
 *
 * Warum zusätzlich zum Umzug: ein Umzug verschiebt immer den GANZEN Block –
 * bei Schichten von 3..9 h springt das Tages-Soll dadurch grob. Ein Tausch
 * verschiebt nur die Differenz der beiden Längen (z.B. 9 h gegen 7 h = 2 h)
 * und trifft die Tagesnachfrage deutlich feiner.
 *
 * Wie der Umzug ändert der Tausch keine Dauer und verletzt keine harte Regel
 * => jedes Monats-Soll bleibt exakt erhalten.
 */
/**
 * Dürfen diese zwei Dienste die Tage tauschen, ohne eine harte Regel zu brechen?
 *
 * `allowSameEmployee` erlaubt den Sonderfall, dass BEIDE Dienste derselben
 * Person gehören. Dann tauschen faktisch nur die Längen zwischen zwei ihrer
 * Arbeitstage: die Arbeitstage selbst bleiben dieselben, also können weder die
 * Ein-Dienst-pro-Tag-Regel noch die Sechs-Tage-Regel verletzt werden. Für die
 * Stoßzeiten-Reparatur ist das der wichtigste Zug überhaupt – ein Tag, dem ein
 * langer Dienst fehlt, findet unter fremden Diensten oft keinen Spender, wohl
 * aber unter den eigenen Tagen desselben Mitarbeiters.
 */
function canSwap(state: SchedulerState, a: Shift, b: Shift, allowSameEmployee = false): boolean {
  if (a.date === b.date) return false;

  const sameEmployee = a.employeeId === b.employeeId;
  if (sameEmployee && !allowSameEmployee) return false; // sonst wäre es ein Umzug

  if (!sameEmployee) {
    const workedA = state.worked.get(a.employeeId)!;
    const workedB = state.worked.get(b.employeeId)!;
    // Höchstens ein Dienst pro Mitarbeiter und Tag.
    if (workedA.has(b.date) || workedB.has(a.date)) return false;

    // 6-Tage-Regel für beide, jeweils ohne den eigenen alten Tag.
    const trialA = new Set(workedA);
    trialA.delete(a.date);
    if (consecutiveRunLengthWith(trialA, b.date) > 6) return false;
    const trialB = new Set(workedB);
    trialB.delete(b.date);
    if (consecutiveRunLengthWith(trialB, a.date) > 6) return false;
  }

  // Die getauschten Längen müssen in das jeweilige Fenster passen.
  if (windowLength(state.dayOf(a.date)) < presenceFromPaid(b.paidMinutes)) return false;
  if (windowLength(state.dayOf(b.date)) < presenceFromPaid(a.paidMinutes)) return false;

  return true;
}

/** Führt den Tausch aus: a wandert auf b.date, b auf a.date. Dauer bleibt. */
function performSwap(
  state: SchedulerState,
  a: Shift,
  b: Shift,
  employeesById: Map<string, Employee>,
): void {
  const empA = employeesById.get(a.employeeId)!;
  const empB = employeesById.get(b.employeeId)!;
  const dateA = a.date;
  const dateB = b.date;
  const paidA = a.paidMinutes;
  const paidB = b.paidMinutes;
  removeShift(state, a);
  removeShift(state, b);
  applyShift(state, makeShift(state, empA, dateB, paidA));
  applyShift(state, makeShift(state, empB, dateA, paidB));
}

/**
 * Zweiter Reparaturlauf, diesmal ausschließlich für die Stoßzeit.
 *
 * repairDemand optimiert nur die Tagesstunden. Ein Tag kann damit rechnerisch
 * genau richtig liegen und die Stoßzeit trotzdem nicht besetzen – etwa 16 h
 * als 7 h + 9 h statt 8 h + 8 h. Von selbst repariert sich das nie, weil jeder
 * Tausch, der die Form verbessert, die Stundenbilanz leicht verschlechtert und
 * deshalb dort abgelehnt wird.
 *
 * Hier gilt die umgekehrte Priorität: ein Tag ohne genug lange Dienste tauscht
 * einen kurzen gegen einen langen von einem Tag, der ihn entbehren kann. Die
 * Stundenverschiebung wird bewusst in Kauf genommen – die Stoßzeiten-Regel ist
 * eine Vorgabe des Betriebs, die Tagesgewichtung nur ein Richtwert.
 */
function repairPeakCapacity(state: SchedulerState, employeesById: Map<string, Employee>): void {
  const MAX_PASSES = 4;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false;

    for (const isoDate of state.dates) {
      const needHours = missingCoverHours(state, isoDate);
      if (needHours === 0) continue; // Tag ist versorgt

      // Kürzeste zuerst hergeben: die reißt die geringste Lücke.
      const tooShort = state.shifts
        .filter((s) => s.date === isoDate && s.paidMinutes < needHours * 60)
        .sort((x, y) => x.paidMinutes - y.paidMinutes);

      let swapped = false;
      for (const short of tooShort) {
        for (const long of [...state.shifts]) {
          if (long.date === isoDate) continue;
          if (long.paidMinutes < needHours * 60) continue; // taugt hier nicht

          // Der abgebende Tag darf dadurch nicht selbst unterversorgt werden.
          const donorHours = dayPaidHours(state, long.date);
          const afterDonor = donorHours
            .filter((_, i) => i !== donorHours.indexOf(long.paidMinutes / 60))
            .concat(short.paidMinutes / 60);
          if (
            !peakCapacityOk(
              coverSize(state, long.date),
              coverFilledFor(state, long.date, donorHours),
              coverFilledFor(state, long.date, afterDonor),
            )
          ) {
            continue;
          }

          // Auch Tausche innerhalb derselben Person sind hier erlaubt.
          if (!canSwap(state, short, long, true)) continue;

          performSwap(state, short, long, employeesById);
          improved = true;
          swapped = true;
          break;
        }
        if (swapped) break;
      }
    }

    if (!improved) break;
  }
}

function trySwaps(state: SchedulerState, employeesById: Map<string, Employee>): boolean {
  let improved = false;
  const snapshot = [...state.shifts];

  for (let i = 0; i < snapshot.length; i++) {
    const a = snapshot[i];
    if (!state.shifts.includes(a)) continue; // schon getauscht
    for (let j = i + 1; j < snapshot.length; j++) {
      const b = snapshot[j];
      if (!state.shifts.includes(b)) continue;
      if (a.date === b.date) continue; // gleicher Tag => keine Wirkung
      if (a.paidMinutes === b.paidMinutes) continue; // gleiche Länge => keine Wirkung
      if (a.employeeId === b.employeeId) continue; // das wäre ein Umzug

      const empA = employeesById.get(a.employeeId)!;
      const empB = employeesById.get(b.employeeId)!;
      const workedA = state.worked.get(empA.id)!;
      const workedB = state.worked.get(empB.id)!;
      // Harte Regel: höchstens ein Dienst pro Mitarbeiter und Tag.
      if (workedA.has(b.date) || workedB.has(a.date)) continue;

      // Die getauschten Längen müssen in das jeweilige Fenster passen.
      const dayA = state.dayOf(a.date);
      const dayB = state.dayOf(b.date);
      if (windowLength(dayA) < presenceFromPaid(b.paidMinutes)) continue;
      if (windowLength(dayB) < presenceFromPaid(a.paidMinutes)) continue;

      // 6-Tage-Regel für beide prüfen, jeweils ohne den eigenen alten Tag.
      const trialA = new Set(workedA);
      trialA.delete(a.date);
      if (consecutiveRunLengthWith(trialA, b.date) > 6) continue;
      const trialB = new Set(workedB);
      trialB.delete(b.date);
      if (consecutiveRunLengthWith(trialB, a.date) > 6) continue;

      // Auch der Tausch darf die Stoßzeit nicht abräumen: a landet auf b.date
      // und umgekehrt, die Längen wandern also mit.
      const hoursA = dayPaidHours(state, a.date);
      const hoursB = dayPaidHours(state, b.date);
      const pa = a.paidMinutes / 60;
      const pb = b.paidMinutes / 60;
      const nextA = hoursA.filter((_, i) => i !== hoursA.indexOf(pa)).concat(pb);
      const nextB = hoursB.filter((_, i) => i !== hoursB.indexOf(pb)).concat(pa);
      if (
        !peakCapacityOk(
          coverSize(state, a.date),
          coverFilledFor(state, a.date, hoursA),
          coverFilledFor(state, a.date, nextA),
        )
      ) {
        continue;
      }
      if (
        !peakCapacityOk(
          coverSize(state, b.date),
          coverFilledFor(state, b.date, hoursB),
          coverFilledFor(state, b.date, nextB),
        )
      ) {
        continue;
      }

      const dsA = state.dateState.get(a.date)!;
      const dsB = state.dateState.get(b.date)!;
      const targetA = state.rawTarget.get(a.date)!;
      const targetB = state.rawTarget.get(b.date)!;
      const oldCost =
        Math.abs(dsA.totalPaid - targetA) + Math.abs(dsB.totalPaid - targetB);
      const newCost =
        Math.abs(dsA.totalPaid - a.paidMinutes + b.paidMinutes - targetA) +
        Math.abs(dsB.totalPaid - b.paidMinutes + a.paidMinutes - targetB);
      if (newCost >= oldCost - 1e-6) continue; // nur echte Verbesserungen

      const dateA = a.date;
      const dateB = b.date;
      const paidA = a.paidMinutes;
      const paidB = b.paidMinutes;
      removeShift(state, a);
      removeShift(state, b);
      applyShift(state, makeShift(state, empA, dateB, paidA));
      applyShift(state, makeShift(state, empB, dateA, paidB));
      improved = true;
      break; // a existiert nicht mehr – mit dem nächsten a weitermachen
    }
  }

  return improved;
}

/** Dreht NUR Früh/Spät um. Dauer bleibt gleich => Monats-Soll bleibt exakt. */
function retypeShift(state: SchedulerState, shift: Shift, type: TemplateType): void {
  if (shift.shiftType === type) return;
  const win = state.dayOf(shift.date).window;
  const tpl = getShiftTemplate(shift.paidMinutes / 60, type, win.startMinutes, win.endMinutes);
  const ds = state.dateState.get(shift.date)!;

  if (shift.shiftType === "LATE") ds.latePaid -= shift.paidMinutes;
  shift.startMinutes = tpl.startMinutes;
  shift.endMinutes = tpl.endMinutes;
  shift.pauseMinutes = tpl.pauseMinutes;
  shift.shiftType = tpl.type;
  if (tpl.type === "LATE") ds.latePaid += shift.paidMinutes;
}

/**
 * Nachlauf über die Schichttypen. Zwei Ziele, in dieser Reihenfolge:
 *  1. Die Spätquote je Tag näher an den Sollwert bringen (vorher schwankte
 *     sie stark, obwohl für alle ruhigen Tage derselbe Wert gilt).
 *  2. Wichtiger als jede Quote: an jedem offenen Tag muss jemand aufsperren
 *     UND jemand zusperren. Vorher kam es vor, dass um 11:00 niemand da war.
 * Es wird ausschließlich der Typ gedreht, nie die Dauer – das Soll bleibt exakt.
 */
function balanceShiftTypes(state: SchedulerState): void {
  for (const isoDate of state.dates) {
    const day = state.dayOf(isoDate);
    if (day.closed) continue;

    const onDay = state.shifts.filter((s) => s.date === isoDate);
    if (onDay.length === 0) continue;

    const ds = state.dateState.get(isoDate)!;
    const desired = LATE_SHIFT_RATIOS[state.effKeyOf(isoDate)];

    // 1. Quote annähern: jeweils die Schicht drehen, die am meisten hilft.
    for (let step = 0; step < onDay.length * 2; step++) {
      if (ds.totalPaid === 0) break;
      let best: Shift | null = null;
      let bestDiff = Math.abs(ds.latePaid / ds.totalPaid - desired);
      for (const s of onDay) {
        const late =
          s.shiftType === "LATE" ? ds.latePaid - s.paidMinutes : ds.latePaid + s.paidMinutes;
        const diff = Math.abs(late / ds.totalPaid - desired);
        if (diff < bestDiff - 1e-9) {
          bestDiff = diff;
          best = s;
        }
      }
      if (!best) break;
      retypeShift(state, best, best.shiftType === "LATE" ? "EARLY" : "LATE");
    }

    // 2. Öffnen/Schließen sichern. Mit nur einer Schicht am Tag geht beides
    //    nicht – dann bleibt es bei der Quote-Entscheidung.
    if (onDay.length < 2) continue;

    const shortestOf = (list: Shift[]) =>
      list.length === 0 ? null : list.reduce((a, b) => (a.paidMinutes <= b.paidMinutes ? a : b));

    let flipped: Shift | null = null;
    if (!onDay.some((s) => s.startMinutes === day.window.startMinutes)) {
      const victim = shortestOf(onDay.filter((s) => s.shiftType === "LATE"));
      if (victim) {
        retypeShift(state, victim, "EARLY");
        flipped = victim;
      }
    }
    if (!onDay.some((s) => s.endMinutes === day.window.endMinutes)) {
      const victim = shortestOf(
        onDay.filter((s) => s.shiftType === "EARLY" && s !== flipped),
      );
      if (victim) retypeShift(state, victim, "LATE");
    }

    // 3. Stoßzeiten absichern (12–13 und 17–19 Uhr, je mindestens 2 Personen).
    //    Vorher deckte dieser Schritt nur einen Messpunkt zur Mittagszeit ab;
    //    der Abend war ungeprüft. Jetzt wird über beide Spannen die KLEINSTE
    //    Besetzung geprüft, nicht ein einzelner Zeitpunkt.
    //
    //    Zur Mechanik: Frühschichten hängen am Öffnen, Spätschichten am
    //    Schließen. Damit deckt jede Frühschicht den Mittag und jede
    //    Spätschicht den Abend; beide Spitzen zugleich schafft nur eine lange
    //    Schicht (8/9 h). Gedreht wird ausschließlich der Typ, nie die Dauer –
    //    das Monats-Soll bleibt exakt. Reicht die Tagesmasse nicht aus, bleibt
    //    eine Lücke bestehen; sie ist in analyzeSchedule sichtbar.
    const hasOpener = () => onDay.some((s) => s.startMinutes === day.window.startMinutes);
    const hasCloser = () => onDay.some((s) => s.endMinutes === day.window.endMinutes);

    for (let guard = 0; guard < onDay.length * 3; guard++) {
      const deficit = peakDeficit(onDay, day.window);
      if (deficit === 0) break;

      let best: Shift | null = null;
      let bestDeficit = deficit;
      for (const s of onDay) {
        // shiftType kennt zusätzlich "CUSTOM"; erzeugte Schichten sind immer
        // EARLY oder LATE. Für die Probe wird alles andere wie EARLY behandelt.
        const back: TemplateType = s.shiftType === "LATE" ? "LATE" : "EARLY";
        const target: TemplateType = back === "LATE" ? "EARLY" : "LATE";
        retypeShift(state, s, target);
        // Öffnen/Schließen darf die Spitzenreparatur nicht kaputt machen.
        const ok = hasOpener() && hasCloser();
        const next = ok ? peakDeficit(onDay, day.window) : Number.POSITIVE_INFINITY;
        retypeShift(state, s, back);
        if (next < bestDeficit) {
          bestDeficit = next;
          best = s;
        }
      }

      if (!best) break; // keine Drehung verbessert noch etwas
      retypeShift(state, best, best.shiftType === "LATE" ? "EARLY" : "LATE");
    }

    // 4. Reicht Drehen nicht, die Dienste im Fenster neu ANORDNEN.
    layoutDayForPeaks(day.window, onDay);
  }
}

/** Verschiebt einen Dienst auf eine neue Startzeit; Dauer bleibt gleich. */
function moveShiftTo(shift: Shift, startMinutes: number): void {
  const presence = shift.endMinutes - shift.startMinutes;
  shift.startMinutes = startMinutes;
  shift.endMinutes = startMinutes + presence;
}

/**
 * Startzeiten, an denen ein Dienst überhaupt etwas Nützliches beiträgt:
 * aufsperren, zusperren, oder eine Stoßzeit vollständig abdecken.
 */
function candidateStarts(shift: Shift, window: DayWindow): number[] {
  const presence = shift.endMinutes - shift.startMinutes;
  const latest = window.endMinutes - presence;
  if (latest < window.startMinutes) return [window.startMinutes];

  const out = new Set<number>([window.startMinutes, latest]);
  for (const peak of PEAK_WINDOWS) {
    const from = Math.max(peak.startMinutes, window.startMinutes);
    const to = Math.min(peak.endMinutes, window.endMinutes);
    if (to <= from || presence < to - from) continue;
    const lo = Math.max(window.startMinutes, to - presence);
    const hi = Math.min(from, latest);
    if (lo <= hi) {
      out.add(lo);
      out.add(hi);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Ordnet die Dienste eines Tages so an, dass beide Stoßzeiten besetzt sind
 * und trotzdem jemand auf- und zusperrt. Dauer und Pause bleiben unangetastet
 * => das Monats-Soll bleibt exakt erhalten.
 *
 * Warum nicht einfach Dienst für Dienst verschieben: das bleibt in einem
 * lokalen Optimum stecken. Beispiel 27.07. – eine 8-h-Frühschicht (10:00 bis
 * 18:30) und zwei 5-h-Spätschichten. Mittags steht nur einer im Laden. Wer
 * die Frühschicht verschieben will, nimmt dem Tag den Aufsperrer, also wird
 * der Zug verworfen; erst wenn VORHER eine Spätschicht auf 10:00 rückt, geht
 * es auf. Ein einzelner Zug kommt dort nie hin.
 *
 * Deshalb: Auf- und Zusperrer werden zuerst festgelegt (alle Paare werden
 * durchprobiert), der Rest wird danach frei eingeplant.
 */
function layoutDayForPeaks(window: DayWindow, onDay: Shift[]): void {
  if (onDay.length < 2) return;
  if (peakDeficit(onDay, window) === 0) return; // schon gut
  arrangeForPeaks(window, onDay);
}

/**
 * Der eigentliche Suchlauf – ohne die Abkürzung oben. Wird auch von der
 * Kapazitätsrechnung benutzt, die wissen muss, ob eine Kombination von
 * Schichtlängen überhaupt aufgehen KANN.
 */
function arrangeForPeaks(window: DayWindow, onDay: Shift[]): void {
  if (onDay.length < 2) return;

  const starts = onDay.map((s) => s.startMinutes);
  const restore = (list: number[]) => onDay.forEach((s, i) => moveShiftTo(s, list[i]));
  const opensAndCloses = () =>
    onDay.some((s) => s.startMinutes === window.startMinutes) &&
    onDay.some((s) => s.endMinutes === window.endMinutes);

  let bestStarts = [...starts];
  // Eine Ausgangslage ohne Auf- oder Zusperrer zählt nicht als Lösung.
  let bestDeficit = opensAndCloses() ? peakDeficit(onDay, window) : Number.POSITIVE_INFINITY;

  for (let i = 0; i < onDay.length && bestDeficit > 0; i++) {
    // i === j ist ausdrücklich erlaubt: ein Dienst, der das ganze Fenster
    // füllt (bei 10–20 Uhr eine 9-h-Schicht), sperrt auf UND zu. Schließt man
    // diesen Fall aus, findet die Suche nie die billigste Lösung – zwei
    // getrennte Anker kosten hier 8 + 8 h, ein Dienst über alles plus ein
    // frei stehender nur 9 + 6 h.
    for (let j = 0; j < onDay.length && bestDeficit > 0; j++) {
      restore(starts);

      // i sperrt auf, j sperrt zu.
      const closerStart = window.endMinutes - (onDay[j].endMinutes - onDay[j].startMinutes);
      if (closerStart < window.startMinutes) continue;
      moveShiftTo(onDay[i], window.startMinutes);
      moveShiftTo(onDay[j], closerStart);

      // Alle übrigen Dienste greedy dorthin, wo sie am meisten helfen.
      for (let k = 0; k < onDay.length; k++) {
        if (k === i || k === j) continue;
        let pick = onDay[k].startMinutes;
        let pickDeficit = Number.POSITIVE_INFINITY;
        for (const c of candidateStarts(onDay[k], window)) {
          moveShiftTo(onDay[k], c);
          const d = peakDeficit(onDay, window);
          if (d < pickDeficit) {
            pickDeficit = d;
            pick = c;
          }
        }
        moveShiftTo(onDay[k], pick);
      }

      const deficit = peakDeficit(onDay, window);
      if (deficit < bestDeficit) {
        bestDeficit = deficit;
        bestStarts = onDay.map((s) => s.startMinutes);
      }
    }
  }

  restore(bestStarts);
}

/**
 * Obergrenze für EINEN Mitarbeiter: wie viele Tage und Stunden im Monat
 * überhaupt möglich sind. Greedy von vorn – an jedem offenen Tag arbeiten,
 * solange die 6-Tage-Regel es zulässt; danach zwingend ein freier Tag.
 * Das ist das Maximum, mehr geht rein rechnerisch nicht.
 */
function monthCapacity(
  dates: string[],
  dayOf: (isoDate: string) => ResolvedDay,
  capHours = MAX_SHIFT_HOURS,
): { openDays: number; maxDays: number; maxMinutes: number } {
  let openDays = 0;
  let maxDays = 0;
  let maxMinutes = 0;
  let run = 0;

  for (const isoDate of dates) {
    const day = dayOf(isoDate);
    if (day.closed) {
      run = 0; // geschlossener Tag zählt als Pause
      continue;
    }
    openDays += 1;
    const hours = Math.min(maxShiftHoursForWindow(windowLength(day)), capHours);
    if (hours < 3) continue; // Fenster zu kurz für die kürzeste Schicht (3 h)

    if (run >= 6) {
      run = 0; // Pflicht-Ruhetag
      continue;
    }
    run += 1;
    maxDays += 1;
    maxMinutes += hours * 60;
  }

  return { openDays, maxDays, maxMinutes };
}

/** Fehlermeldung, die auch sagt WARUM es nicht aufgeht. */
function buildUnmetMessage(
  state: SchedulerState,
  unmet: Employee[],
  dates: string[],
  dayOf: (isoDate: string) => ResolvedDay,
): string {
  const full = monthCapacity(dates, dayOf, PREFERRED_HOURS.VOLLZEIT);

  // Ein Soll unter der kürzesten Schicht ist ein EIGENER Fehlerfall. Vorher
  // fiel er in die Kapazitäts-Erklärung: Wer 2 h eintrug, bekam einen Vortrag
  // über die 6-Tage-Regel und eine Stundendecke von über 200 h – beides half
  // nicht weiter. Der wahre Grund ist schlicht, dass 2 h keine Schicht ergibt.
  const tooSmall = unmet.filter((e) => e.targetMinutes > 0 && e.targetMinutes < MIN_SHIFT_MINUTES);
  if (tooSmall.length === unmet.length) {
    const who = tooSmall
      .map((e) => `${e.name} (${e.targetMinutes / 60}h)`)
      .join(", ");
    return (
      `Định mức quá nhỏ: ${who}. ` +
      `Ca ngắn nhất là ${MIN_SHIFT_MINUTES / 60}h, nên định mức phải từ ` +
      `${MIN_SHIFT_MINUTES / 60}h trở lên. Hãy sửa ở tab Nhân viên.`
    );
  }

  const missing = unmet
    .map((e) => {
      const short = state.remaining.get(e.id)!;
      const done = (e.targetMinutes - short) / 60;
      if (e.targetMinutes < MIN_SHIFT_MINUTES) {
        return `${e.name} ${e.targetMinutes / 60}h (nhỏ hơn ca ngắn nhất ${MIN_SHIFT_MINUTES / 60}h)`;
      }
      const capMin = full.maxMinutes;
      const overCap = e.targetMinutes > capMin ? ` — vượt trần ${capMin / 60}h` : "";
      return `${e.name} chỉ xếp được ${done}h / ${e.targetMinutes / 60}h${overCap}`;
    })
    .join("; ");

  if (full.maxDays === 0) {
    return (
      `Không xếp được ca nào (${missing}). ` +
      `Tháng này có ${full.openDays} ngày mở cửa nhưng khung giờ làm quá ngắn — ` +
      `không đủ cho cả ca ngắn nhất (3h). Hãy nới khung giờ làm ở tab Cài đặt.`
    );
  }

  // maxMinutes ist eine OBERGRENZE (jeden erlaubten Tag die längste Schicht).
  // Der greedy Scheduler erreicht sie nicht immer – daher als Decke formulieren.
  return (
    `Không xếp đủ định mức: ${missing}. ` +
    `Tháng này có ${full.openDays} ngày mở cửa; do quy tắc tối đa 6 ngày làm ` +
    `liên tiếp, mỗi người làm được nhiều nhất ${full.maxDays} ngày — trần lý ` +
    `thuyết ${full.maxMinutes / 60}h/người, thực tế thấp hơn. ` +
    `Hãy giảm định mức, nới khung giờ làm, bớt ngày đóng cửa, hoặc thêm người.`
  );
}

/**
 * Hauptfunktion: erzeugt die Schichten für den Monat.
 * Gibt eine neue Liste generierter Shifts zurück (verändert keine Eingaben).
 */
export function generateSchedule(input: GenerateInput): Shift[] {
  shiftIdCounter = 0;
  const { year, month, workHours, employees } = input;
  const holidays = input.holidays ?? publicHolidays(year);
  const overrides = input.overrides ?? {};

  const effKeyOf = (isoDate: string): WeekdayKey => effectiveWeekdayKey(isoDate, holidays);
  const dayOf = (isoDate: string): ResolvedDay => resolveDay(workHours, isoDate, holidays, overrides);
  // Nachfrage-Gewicht: geschlossene Tage tragen 0 (bekommen keine Stunden).
  const weightOf = (isoDate: string): number =>
    dayOf(isoDate).closed ? 0 : DAY_WEIGHTS[effKeyOf(isoDate)];

  const dates = datesOfMonth(year, month);
  const totalTargetMin = employees.reduce((sum, e) => sum + e.targetMinutes, 0);
  const totalWeight = dates.reduce((sum, d) => sum + weightOf(d), 0);

  // Erst der Boden für die Stoßzeit, dann die Gewichtung auf den Rest.
  // Reicht die Gesamtsumme nicht einmal für den Boden, wird rein nach Gewicht
  // verteilt – dann ist der Monat für die Stoßzeiten-Regel schlicht zu dünn
  // besetzt, und das Dashboard weist die Lücken aus.
  const floors = new Map<string, number>();
  let totalFloor = 0;
  for (const d of dates) {
    const f = peakFloorMinutes(dayOf(d));
    floors.set(d, f);
    totalFloor += f;
  }

  const rawTarget = new Map<string, number>();
  const spare = totalTargetMin - totalFloor;
  for (const d of dates) {
    if (totalWeight <= 0) {
      rawTarget.set(d, 0);
    } else if (spare >= 0) {
      rawTarget.set(d, floors.get(d)! + (spare * weightOf(d)) / totalWeight);
    } else {
      rawTarget.set(d, (totalTargetMin * weightOf(d)) / totalWeight);
    }
  }

  const dateState = new Map<string, DateState>();
  const worked = new Map<string, Set<string>>();
  const weekendCount = new Map<string, number>();
  const remaining = new Map<string, number>();
  for (const d of dates) dateState.set(d, { totalPaid: 0, latePaid: 0, count: 0 });
  for (const e of employees) {
    worked.set(e.id, new Set());
    weekendCount.set(e.id, 0);
    remaining.set(e.id, e.targetMinutes);
  }

  const seed =
    input.seed ??
    `${year}-${month}-${employees.map((e) => `${e.id}:${e.targetMinutes}`).join("|")}`;

  const employeesById = new Map(employees.map((e) => [e.id, e] as const));
  const ordered = orderedEmployees(employees);
  const n = ordered.length;

  /**
   * Ein kompletter Belegungsversuch. varyLengths=true mischt die Schichtlängen
   * (4..8 h statt immer die längste); das ist schöner, kann aber bei knappem
   * Soll die Tage aufbrauchen. Deshalb gibt es den zweiten, strengen Versuch.
   */
  function attempt(varyLengths: boolean, salt = ""): SchedulerState {
    shiftIdCounter = 0;
    const st: SchedulerState = {
      dates,
      rawTarget,
      dateState: new Map(dates.map((d) => [d, { totalPaid: 0, latePaid: 0, count: 0 }])),
      worked: new Map(employees.map((e) => [e.id, new Set<string>()])),
      weekendCount: new Map(employees.map((e) => [e.id, 0])),
      remaining: new Map(employees.map((e) => [e.id, e.targetMinutes])),
      shifts: [],
      effKeyOf,
      dayOf,
      rng: seededRandom(seed + salt),
      varyLengths,
    };

    // Rundenweise, rotierend platzieren: pro Runde eine Schicht je Mitarbeiter,
    // bis jedes Monats-Soll exakt erreicht ist.
    for (let round = 0; ; round++) {
      if (ordered.every((e) => st.remaining.get(e.id)! <= 0)) break;
      let progress = false;
      for (let i = 0; i < n; i++) {
        const emp = ordered[(i + round) % n];
        if (st.remaining.get(emp.id)! <= 0) continue;
        if (placeOneShift(st, emp)) progress = true;
      }
      if (!progress) break; // keine Platzierung mehr möglich
    }
    return st;
  }

  const incomplete = (st: SchedulerState) =>
    employees.some((e) => st.remaining.get(e.id)! > 0);

  // Mehrere Anläufe mit gemischten Längen (jeweils anderer Zufallsstrom).
  // Klappt keiner, wird streng die längste Schicht genommen – damit ist das
  // Ergebnis nie schlechter als ohne Abwechslung.
  let state = attempt(true);
  for (let k = 1; k < 5 && incomplete(state); k++) {
    state = attempt(true, `#${k}`);
  }
  if (incomplete(state)) state = attempt(false);

  const unmet = employees.filter((e) => state.remaining.get(e.id)! > 0);
  if (unmet.length > 0) {
    throw new Error(buildUnmetMessage(state, unmet, dates, dayOf));
  }

  repairDemand(state, employeesById);
  // Erst danach: die Stundenbilanz steht, jetzt die Form für die Stoßzeit.
  repairPeakCapacity(state, employeesById);
  balanceShiftTypes(state);

  // Stabil sortieren: nach Datum, dann Startzeit, dann Mitarbeiter.
  state.shifts.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.startMinutes - b.startMinutes ||
      a.employeeId.localeCompare(b.employeeId),
  );
  return state.shifts;
}
