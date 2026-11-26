import type { UseScheduleReturn } from "../hooks/useSchedule";
import { minutesToDecimalHours, minutesToTime } from "../lib/time";
import { PEAK_WINDOWS } from "../lib/scheduler";

/** "2026-08-27" -> "27.08." – kurz, weil oft mehrere Tage nebeneinander stehen. */
function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}.${month}.`;
}

export function Dashboard({ store }: { store: UseScheduleReturn }) {
  const { schedule, validation, peakGaps } = store;
  const vz = schedule.employees.filter((e) => e.employmentType === "VOLLZEIT").length;
  const tz = schedule.employees.filter((e) => e.employmentType === "TEILZEIT").length;
  const mj = schedule.employees.filter((e) => e.employmentType === "MINIJOB").length;
  const targetMin = validation.summaries.reduce((s, e) => s + e.targetMinutes, 0);
  const plannedMin = schedule.shifts.reduce((s, x) => s + x.paidMinutes, 0);
  const notGenerated = schedule.shifts.length === 0;

  // Trước khi tạo lịch: trạng thái trung tính (chưa xếp giờ nào nên chưa thể "lỗi").
  const statusValue = notGenerated
    ? "Chưa tạo lịch"
    : validation.valid
      ? "Hợp lệ"
      : `${validation.errors.length} lỗi`;
  const statusAccent = notGenerated
    ? "text-slate-500"
    : validation.valid
      ? "text-emerald-600"
      : "text-rose-600";

  const pct = targetMin > 0 ? Math.min(100, Math.round((plannedMin / targetMin) * 100)) : 0;
  const statusPill =
    statusAccent === "text-emerald-600"
      ? "bg-emerald-50 text-emerald-700"
      : statusAccent === "text-rose-600"
        ? "bg-rose-50 text-rose-700"
        : (statusAccent as string) === "text-amber-600"
          ? "bg-amber-50 text-amber-700"
          : "bg-slate-100 text-slate-500";

  return (
    <div>
      {/* Eine Karte statt Zahlenkacheln (wie die Demo): Stunden als Balken. */}
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-slate-500">Giờ đã xếp · {schedule.employees.length} người ({vz} TT · {tz} BT · {mj} MJ)</span>
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusPill}`}>
            {statusValue === "Hợp lệ" ? "✓ Hợp lệ" : statusValue}
          </span>
        </div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold text-slate-900">{minutesToDecimalHours(plannedMin)}</span>
          <span className="text-sm text-slate-500">/ {minutesToDecimalHours(targetMin)} h định mức</span>
          <span className="ml-auto text-sm font-semibold text-slate-500">{pct}%</span>
        </div>
        <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-slate-100">
          <div className="bg-slate-700" style={{ width: `${pct}%` }} />
          {plannedMin > 0 && pct < 100 && <div className="bg-amber-300" style={{ width: `${100 - pct}%` }} />}
        </div>
      </div>
      {notGenerated && schedule.employees.length > 0 && (
        <div className="mt-2 rounded bg-sky-50 border border-sky-200 text-sky-800 text-sm px-3 py-2">
          Chưa có lịch — bấm Tạo lịch.
        </div>
      )}
      {validation.valid && schedule.shifts.length > 0 && (
        <div className="mt-2 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-3 py-2">
          Tất cả giờ định mức đã được phân bổ chính xác.
        </div>
      )}
      {/*
        Giờ cao điểm thiếu người KHÔNG phải lỗi định mức — lịch vẫn đúng giờ
        công. Nó chỉ có nghĩa là tổng giờ trong ngày quá mỏng để lúc nào cũng
        có 2 người. Trước đây chuyện này diễn ra âm thầm, không ai biết.
      */}
      {peakGaps.length > 0 && (
        <div className="mt-2 rounded bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2">
          {/*
            Fenster und Mindestbesetzung kommen aus PEAK_WINDOWS. Vorher stand
            der Text fest im Code – nach der Umstellung auf eine durchgehende
            Stoßzeit nannte die Warnung noch die alten Zeiten.
          */}
          <div className="font-medium">
            {peakGaps.length} ngày chưa đủ người trong giờ cao điểm (
            {PEAK_WINDOWS.map(
              (p) =>
                `${minutesToTime(p.startMinutes)}–${minutesToTime(p.endMinutes)}: ${p.minStaff} người`,
            ).join(", ")}
            ).
          </div>
          <div className="mt-1 space-y-0.5">
            {peakGaps.slice(0, 6).map((d) => (
              <div key={d.date}>
                {shortDate(d.date)}{" "}
                {d.peaks
                  .filter((p) => !p.ok)
                  .map((p) => `${p.minStaff}/${p.required} người`)
                  .join(" · ")}{" "}
                <span className="opacity-70">({d.shiftCount} ca, {d.paidHours}h)</span>
              </div>
            ))}
            {peakGaps.length > 6 && <div className="opacity-70">… và {peakGaps.length - 6} ngày nữa</div>}
          </div>
          <div className="mt-1 opacity-80">
            Cách xử lý: tăng định mức cho nhân viên, thêm người, hoặc chấp nhận những ngày này.
          </div>
        </div>
      )}
    </div>
  );
}
