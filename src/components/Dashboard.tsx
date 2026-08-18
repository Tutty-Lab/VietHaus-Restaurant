import type { UseScheduleReturn } from "../hooks/useSchedule";
import { minutesToDecimalHours, minutesToTime } from "../lib/time";
import { PEAK_WINDOWS } from "../lib/scheduler";

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg bg-white border border-slate-200 px-2.5 py-1.5 sm:px-3 sm:py-2 shadow-sm">
      <div className="text-[11px] sm:text-xs text-slate-500 leading-tight">{label}</div>
      <div className={`text-base sm:text-lg font-semibold leading-tight ${accent ?? "text-slate-900"}`}>
        {value}
      </div>
    </div>
  );
}

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
  const targetMin = schedule.employees.reduce((s, e) => s + e.targetMinutes, 0);
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

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <Stat label="Số nhân viên" value={String(schedule.employees.length)} />
        <Stat label="Toàn thời gian" value={String(vz)} />
        <Stat label="Bán thời gian" value={String(tz)} />
        <Stat label="Minijob" value={String(mj)} />
        <Stat label="Tổng giờ định mức" value={`${minutesToDecimalHours(targetMin)} h`} />
        <Stat label="Tổng giờ đã xếp" value={`${minutesToDecimalHours(plannedMin)} h`} />
        <Stat label="Trạng thái kiểm tra" value={statusValue} accent={statusAccent} />
      </div>
      {notGenerated && schedule.employees.length > 0 && (
        <div className="mt-2 rounded bg-sky-50 border border-sky-200 text-sky-800 text-sm px-3 py-2">
          Chưa có lịch. Sang tab „Lịch làm việc" và bấm „Tạo lịch làm việc".
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
