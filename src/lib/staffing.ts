import type { Shift } from "../types";
import { DAY_WEIGHTS, type WeekdayKey } from "./demand";
import type { DayBlocks, DayWindow } from "./workHours";

export type StaffingWindow = {
  label: string;
  startMinutes: number;
  endMinutes: number;
  minStaff: number;
  maxStaff: number;
};

/** Ab hier läuft der Abend aus – bis dahin muss jemand im Laden bleiben. */
export const CLOSING_START = 21 * 60 + 30;
export const CLOSING_MIN = 1;
export const CLOSING_MAX = Infinity;
/** VietHaus hat keine Mittagsschließung – Ende des (einzigen) Blocks. */
export const LUNCH_END = 22 * 60;

/**
 * Eine Besetzungsregel: WO (Zeitspanne je Öffnungsblock) und WIE VIELE.
 *
 * minStaff/maxStaff sind der Wert eines Normaltags (Gewicht 1,0). Bei
 * scaled = true werden sie mit dem Tagesgewicht (DAY_WEIGHTS) multipliziert und
 * aufgerundet – starke Tage tragen so automatisch mehr.
 *
 * Einzige Quelle für Scheduler, Độ phủ-Bericht und Tab „Tài liệu": wer die
 * Besetzung eines Ladens ändert, ändert nur diese Liste.
 */
export type StaffingRule = {
  label: string;
  /** Kurzbeschreibung der Zeitspanne für den Tab „Tài liệu". */
  when: string;
  minStaff: number;
  maxStaff: number;
  scaled: boolean;
  /** Nur an diesen (effektiven) Wochentagen; fehlt = an jedem offenen Tag. */
  weekdays?: readonly WeekdayKey[];
  windows: (blocks: DayBlocks) => DayWindow[];
};

/** Schneidet eine feste Uhrzeitspanne mit jedem Öffnungsblock. */
export const clip = (from: number, to: number) => (blocks: DayBlocks): DayWindow[] =>
  blocks
    .map((block) => ({ startMinutes: Math.max(from, block.startMinutes), endMinutes: Math.min(to, block.endMinutes) }))
    .filter((window) => window.endMinutes > window.startMinutes);

/**
 * VietHaus (11:30–22:00 durchgehend, wie in der alten App):
 *  - Suốt giờ mở luôn có ít nhất 1 người; đóng cửa 21:30–22:00 không bao giờ trống.
 *  - Tối 18:00–21:00 ít nhất 2 người, mỗi ngày.
 */
export const STAFFING_RULES: readonly StaffingRule[] = [
  {
    label: "Trong giờ mở cửa", when: "suốt giờ mở", minStaff: 1, maxStaff: Infinity, scaled: false,
    windows: (blocks) => blocks.map((block) => ({ startMinutes: block.startMinutes, endMinutes: block.endMinutes })),
  },
  { label: "Tối", when: "18:00–21:00", minStaff: 2, maxStaff: Infinity, scaled: false, windows: clip(18 * 60, 21 * 60) },
  {
    label: "Đóng cửa", when: "21:30–22:00", minStaff: CLOSING_MIN, maxStaff: CLOSING_MAX, scaled: false,
    windows: clip(CLOSING_START, 22 * 60),
  },
];

/** Mindest-/Höchstzahl einer Regel an einem Wochentag (Gewicht angewandt, aufgerundet). */
export function ruleRange(rule: StaffingRule, weekday: WeekdayKey): { minStaff: number; maxStaff: number } {
  const weight = rule.scaled ? DAY_WEIGHTS[weekday] : 1;
  return {
    minStaff: Math.ceil(rule.minStaff * weight),
    maxStaff: Number.isFinite(rule.maxStaff) ? Math.ceil(rule.maxStaff * weight) : Infinity,
  };
}

export function ruleAppliesOn(rule: StaffingRule, weekday: WeekdayKey): boolean {
  return !rule.weekdays || rule.weekdays.includes(weekday);
}

export function staffingWindows(
  blocks: DayBlocks,
  weekday: WeekdayKey,
  rules: readonly StaffingRule[] = STAFFING_RULES,
): StaffingWindow[] {
  return rules.filter((rule) => ruleAppliesOn(rule, weekday)).flatMap((rule) => {
    const range = ruleRange(rule, weekday);
    return rule.windows(blocks).map((window) => ({ label: rule.label, ...window, ...range }));
  });
}

// ── Đường nhu cầu trong ngày ────────────────────────────────────────────────
/**
 * Nhu cầu tương đối theo giờ (1,0 = bình thường) – dạng „ngọn núi": chuẩn bị,
 * lên dốc, đỉnh, xuống dốc. Thuật toán chia GIỜ CÔNG CỦA NGÀY (đã nhân hệ số
 * ngày) theo đường này thành số người mục tiêu cho từng 30 phút, rồi phạt độ
 * lệch theo bình phương – nhờ vậy số người lên xuống mượt, không dồn cục.
 *
 * VietHaus mở liền 11:30–22:00, khách chủ yếu buổi tối; cuối tuần (T6–CN, lễ)
 * tối đông hơn (cột phải).
 */
export type DemandBand = { startMinutes: number; endMinutes: number; level: number; label: string };

const band = (from: string, to: string, level: number, label: string): DemandBand => {
  const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  return { startMinutes: toMinutes(from), endMinutes: toMinutes(to), level, label };
};

export const DEMAND_PROFILE: { weekday: readonly DemandBand[]; sunday: readonly DemandBand[] } = {
  weekday: [
    band("11:30", "12:00", 0.8, "Mở cửa, chuẩn bị"),
    band("12:00", "13:30", 1.1, "Trưa"),
    band("13:30", "17:00", 0.75, "Chiều vắng"),
    band("17:00", "18:00", 1.0, "Chuẩn bị tối"),
    band("18:00", "20:30", 1.4, "Cao điểm tối"),
    band("20:30", "21:30", 1.1, "Sau cao điểm"),
    band("21:30", "22:00", 0.85, "Đóng cửa"),
  ],
  // T6–CN và ngày lễ: tối đông và kéo dài hơn.
  sunday: [
    band("11:30", "12:00", 0.9, "Mở cửa, chuẩn bị"),
    band("12:00", "14:00", 1.2, "Trưa"),
    band("14:00", "17:00", 0.85, "Chiều"),
    band("17:00", "18:00", 1.2, "Chuẩn bị tối"),
    band("18:00", "21:00", 1.7, "Cao điểm tối"),
    band("21:00", "21:30", 1.1, "Sau cao điểm"),
    band("21:30", "22:00", 0.9, "Đóng cửa"),
  ],
};

export function demandProfileOf(
  weekday: WeekdayKey,
  weights: Record<WeekdayKey, number> = DAY_WEIGHTS,
): readonly DemandBand[] {
  // Ngày đông (hệ số ≥ 1,35: T6, T7, CN, lễ) dùng đường tối cao hơn.
  return weights[weekday] >= 1.35 ? DEMAND_PROFILE.sunday : DEMAND_PROFILE.weekday;
}

/** Relative workload at a minute (1 outside all bands). */
export function workloadAt(
  minute: number,
  weekday: WeekdayKey,
  weights: Record<WeekdayKey, number> = DAY_WEIGHTS,
): number {
  return demandProfileOf(weekday, weights).find((b) => minute >= b.startMinutes && minute < b.endMinutes)?.level ?? 1;
}

/**
 * Số người mục tiêu cho từng 30 phút mở cửa:
 *   mục tiêu = giờ công của ngày × mức nhu cầu ÷ tổng mức cả ngày (tính theo phút).
 * Trả về [phút bắt đầu, số người mục tiêu].
 */
export function slotTargets(
  blocks: DayBlocks,
  weekday: WeekdayKey,
  targetHours: number,
  slot = 30,
  weights: Record<WeekdayKey, number> = DAY_WEIGHTS,
): [number, number][] {
  const slots: [number, number][] = [];
  for (const block of blocks) {
    for (let minute = block.startMinutes; minute < block.endMinutes; minute += slot) {
      slots.push([minute, workloadAt(minute, weekday, weights)]);
    }
  }
  const levelMinutes = slots.reduce((sum, [, level]) => sum + level * slot, 0);
  const scale = levelMinutes > 0 ? (targetHours * 60) / levelMinutes : 0;
  return slots.map(([minute, level]) => [minute, level * scale]);
}

export function validPause(shift: Shift): boolean {
  const start = shift.pauseStartMinutes;
  return start != null && shift.pauseMinutes > 0 && start > shift.startMinutes &&
    start + shift.pauseMinutes < shift.endMinutes && start - shift.startMinutes <= 360 &&
    shift.endMinutes - start - shift.pauseMinutes <= 360;
}

export function workingAt(shift: Shift, minute: number): boolean {
  return shift.startMinutes <= minute && shift.endMinutes > minute &&
    !(validPause(shift) && minute >= shift.pauseStartMinutes! && minute < shift.pauseStartMinutes! + shift.pauseMinutes);
}

export function coveragePoints(shifts: Shift[], from: number, to: number): number[] {
  return [...new Set([from, to, ...shifts.flatMap((s) => [s.startMinutes, s.endMinutes,
    ...(validPause(s) ? [s.pauseStartMinutes!, s.pauseStartMinutes! + s.pauseMinutes] : []),
  ]).filter((t) => t > from && t < to)])].sort((a, b) => a - b);
}

/**
 * Giờ công mục tiêu mỗi ngày, chuẩn hoá trong từng ISO-week (không mượn giữa các tuần):
 *   giờ ngày = giờ tuần × (hệ số × phút mở) ÷ Σ(hệ số × phút mở)
 * Nhân phút mở để hệ số là MẬT ĐỘ người. Không truyền openMinutesOf => chỉ theo hệ số.
 */
export function weightedDailyTargets(
  dates: string[],
  total: number,
  weekdayOf: (date: string) => WeekdayKey,
  openMinutesOf?: (date: string) => number,
  weights: Record<WeekdayKey, number> = DAY_WEIGHTS,
): Map<string, number> {
  const factor = (date: string) => weights[weekdayOf(date)] * (openMinutesOf ? openMinutesOf(date) : 1);
  const sum = dates.reduce((acc, date) => acc + factor(date), 0);
  return new Map(dates.map((date) => [date, sum > 0 ? total * factor(date) / sum : 0]));
}
