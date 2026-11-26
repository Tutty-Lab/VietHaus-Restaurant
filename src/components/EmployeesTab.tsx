import { employmentPeriodError, monthlyTargetMinutesFor, openDatesFor } from "../lib/employeePeriod";
import { useMemo, useState } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import type { Employee, EmploymentType } from "../types";
import { splitTargetHours } from "../lib/splitTargetHours";
import { WEEKDAY_SHORT_VI, type WeekdayKey } from "../lib/demand";
import { employmentShortVi } from "../lib/employment";

const inputClass =
  "rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base sm:text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";

const WEEKDAY_ORDER: WeekdayKey[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

/**
 * Ab hier wird gewarnt. 192 h = 24 Tage à 8 h; darüber wird der Monat sehr
 * eng (6-Tage-Regel) und arbeitsrechtlich heikel.
 */
export const WARN_HOURS = 192;

/** Số ngày làm (= số ca) cho một mục tiêu, hoặc thông báo lỗi. */
function splitInfo(targetHours: number, type: EmploymentType): { ok: boolean; text: string } {
  if (targetHours <= 0) return { ok: true, text: "—" };
  try {
    const parts = splitTargetHours(Math.round(targetHours), type);
    return { ok: true, text: `${parts.length} ca` };
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : "không hợp lệ" };
  }
}

type Draft = {
  name: string;
  employmentType: EmploymentType;
  hours: string;
  availableWeekdays: WeekdayKey[]; // [] = mọi ngày
  maxDays: string;
  startDate: string;
  endDate: string;
};

function draftFrom(emp?: Employee): Draft {
  return {
    startDate: emp?.startDate ?? "",
    endDate: emp?.endDate ?? "",
    name: emp?.name ?? "",
    employmentType: emp?.employmentType ?? "VOLLZEIT",
    hours: emp ? String(emp.targetMinutes / 60) : "176",
    availableWeekdays: emp?.availableWeekdays ?? [],
    maxDays: emp?.maxDaysPerWeek ? String(Math.min(6, emp.maxDaysPerWeek)) : "",
  };
}

function draftToEmployee(d: Draft): Omit<Employee, "id"> {
  const stunden = Math.max(0, Math.round(Number(d.hours) || 0));
  const tage = Number(d.maxDays);
  return {
    name: d.name.trim() || "Nhân viên mới",
    employmentType: d.employmentType,
    targetMinutes: stunden * 60,
    startDate: d.startDate || undefined,
    endDate: d.endDate || undefined,
    availableWeekdays:
      d.availableWeekdays.length === 0 || d.availableWeekdays.length === 7
        ? undefined
        : [...d.availableWeekdays],
    maxDaysPerWeek: d.maxDays === "" || tage < 1 ? undefined : Math.min(6, Math.round(tage)),
  };
}

export function EmployeesTab({ store }: { store: UseScheduleReturn }) {
  const { schedule, addEmployee, updateEmployee, removeEmployee, isLocked } = store;

  const [offen, setOffen] = useState<null | "new" | string>(null);
  const bearbeitet = useMemo(
    () =>
      typeof offen === "string" && offen !== "new"
        ? schedule.employees.find((e) => e.id === offen)
        : undefined,
    [offen, schedule.employees],
  );

  return (
    <section className="rounded-lg bg-white border border-slate-200 p-4 sm:p-5 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-semibold text-slate-900">
          Nhân viên
          {schedule.employees.length > 0 && (
            <span className="ml-2 text-sm font-normal text-slate-400">
              {schedule.employees.length}
            </span>
          )}
        </h2>
        <button
          onClick={() => setOffen("new")}
          disabled={isLocked}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 active:bg-slate-800 disabled:opacity-40"
        >
          + Thêm
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Giờ nhập theo <b>tháng</b>. Bấm vào một người để sửa (hình thức, giờ, ngày làm trong
        tuần, số ngày/tuần).
      </p>

      {isLocked && (
        <div className="mb-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2">
          <b>Tháng này đã khoá</b> vì lịch đã in — mở khoá ở tab <b>Bảng chấm công</b> để sửa
          nhân viên.
        </div>
      )}

      {schedule.employees.length === 0 ? (
        <div className="py-8 text-center text-slate-400">
          Chưa có nhân viên. Bấm <b>+ Thêm</b> để tạo.
        </div>
      ) : (
        <ul className="space-y-2">
          {schedule.employees.map((emp) => (
            <li key={emp.id}>
              <button
                onClick={() => setOffen(emp.id)}
                className="w-full text-left rounded-lg border border-slate-200 p-3 flex items-center gap-3 hover:bg-slate-50 active:bg-slate-100 transition-colors"
              >
                <EmployeeSummaryRow emp={emp} target={monthlyTargetMinutesFor(emp, openDatesFor(schedule))} />
                <span className="text-slate-300 text-lg leading-none">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!isLocked && (
        <button
          onClick={() => setOffen("new")}
          aria-label="Thêm nhân viên"
          className="sm:hidden fixed bottom-5 right-5 z-40 h-14 w-14 rounded-full bg-slate-900 text-white text-2xl shadow-lg active:bg-slate-700 flex items-center justify-center"
        >
          +
        </button>
      )}

      {offen !== null && !isLocked && (
        <EmployeeSheet
          key={bearbeitet?.id ?? "new"}
          employee={bearbeitet}
          openDates={openDatesFor(schedule)}
          onClose={() => setOffen(null)}
          onSave={(felder) => {
            if (bearbeitet) updateEmployee(bearbeitet.id, felder);
            else addEmployee(felder);
            setOffen(null);
          }}
          onDelete={
            bearbeitet
              ? () => {
                  removeEmployee(bearbeitet.id);
                  setOffen(null);
                }
              : undefined
          }
        />
      )}
    </section>
  );
}

function EmployeeSummaryRow({ emp, target }: { emp: Employee; target: number }) {
  const stunden = target / 60;
  const info = splitInfo(stunden, emp.employmentType);
  const tooMany = stunden > WARN_HOURS;
  const tage = emp.availableWeekdays;

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <span className="font-medium text-slate-900 truncate">{emp.name}</span>
        <span className="shrink-0 rounded bg-slate-100 text-slate-600 text-[11px] px-1.5 py-0.5">
          {employmentShortVi(emp.employmentType)}
        </span>
        {tooMany && <span className="shrink-0 text-amber-600 text-xs">⚠</span>}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
        <span>
          {stunden}h tháng này / hợp đồng {emp.targetMinutes / 60}h · <span className={info.ok ? "" : "text-rose-600"}>{info.text}</span>
        </span>
        {tage && tage.length > 0 && (
          <span className="text-slate-400">· {tage.map((k) => WEEKDAY_SHORT_VI[k]).join(" ")}</span>
        )}
        {emp.maxDaysPerWeek ? (
          <span className="text-slate-400">· {emp.maxDaysPerWeek} ngày/tuần</span>
        ) : null}
      </div>
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (value: T) => void;
}) {
  return <div className="flex gap-1 rounded-lg bg-slate-100 p-1">{options.map(option =>
    <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}
      className={`flex-1 rounded-md px-2 py-2.5 text-sm font-medium ${value === option.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>{option.label}</button>
  )}</div>;
}

function EmployeeSheet({ employee, openDates, onClose, onSave, onDelete }: {
  employee?: Employee; openDates: string[]; onClose: () => void;
  onSave: (fields: Omit<Employee, "id">) => void; onDelete?: () => void;
}) {
  const [d, setD] = useState<Draft>(() => draftFrom(employee));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [advanced, setAdvanced] = useState(Boolean(employee?.startDate || employee?.endDate));
  const [showPeriod, setShowPeriod] = useState(Boolean(employee?.startDate || employee?.endDate));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setD(prev => ({ ...prev, [key]: value }));
  const monthHours = monthlyTargetMinutesFor({ ...draftToEmployee(d), id: employee?.id ?? "preview" }, openDates) / 60;
  const periodError = employmentPeriodError(d.startDate, d.endDate);
  const daysOff = WEEKDAY_ORDER.filter(day => d.availableWeekdays.length > 0 && !d.availableWeekdays.includes(day));
  const hoursBad = !d.hours.trim() || !Number.isFinite(Number(d.hours)) || Number(d.hours) < 0 || !Number.isInteger(Number(d.hours));
  const info = splitInfo(monthHours, d.employmentType);
  const toggleDayOff = (day: WeekdayKey) => {
    const nextOff = daysOff.includes(day) ? daysOff.filter(x => x !== day) : [...daysOff, day];
    if (nextOff.length === 7) return;
    set("availableWeekdays", nextOff.length ? WEEKDAY_ORDER.filter(x => !nextOff.includes(x)) : []);
  };
  const sectionTitle = "text-sm font-semibold text-slate-900";
  const labelClass = "mb-1.5 block text-xs font-medium text-slate-600";
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-labelledby="employee-sheet-title" onClick={event => event.stopPropagation()}
      className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-xl sm:max-w-lg sm:rounded-xl">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
        <h3 id="employee-sheet-title" className="font-semibold text-slate-900">{employee ? "Sửa nhân viên" : "Thêm nhân viên"}</h3>
        <button type="button" aria-label="Đóng" onClick={onClose} className="rounded-lg px-3 py-2 text-slate-400 hover:bg-slate-100">✕</button>
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-4">
        <section className="space-y-4">
          <h4 className={sectionTitle}>Thông tin</h4>
          <label className="block"><span className={labelClass}>Tên</span>
            <input autoFocus={!employee} autoCapitalize="words" autoComplete="off" className={`${inputClass} w-full`} value={d.name} onChange={e => set("name", e.target.value)} placeholder="Tên nhân viên" />
          </label>
          <div><span className={labelClass}>Hình thức</span>
            <Segmented<EmploymentType> value={d.employmentType} onChange={v => set("employmentType",v)} options={[{value:"VOLLZEIT",label:"Toàn TG"},{value:"TEILZEIT",label:"Bán TG"},{value:"MINIJOB",label:"Minijob"}]} />
          </div>
          <label className="block"><span className={`${labelClass} flex flex-wrap justify-between gap-1`}><span>Giờ hợp đồng / tháng</span><span className="font-normal text-slate-400">tháng này {periodError || hoursBad ? "—" : `${monthHours}h`} · {info.text}</span></span>
            <input type="number" inputMode="numeric" min={0} step={1} className={`${inputClass} w-full`} value={d.hours} onChange={e => set("hours",e.target.value)} />
          </label>
          {hoursBad && <p role="alert" className="text-xs text-rose-600">Nhập số giờ nguyên từ 0 trở lên.</p>}
          {Number(d.hours) > WARN_HOURS && <p className="text-xs text-amber-700">Hợp đồng trên {WARN_HOURS}h/tháng; kiểm tra số ngày có thể làm.</p>}
        </section>
        <section className="rounded-lg border border-slate-200">
          <button type="button" aria-expanded={advanced} onClick={() => setAdvanced(v=>!v)} className="flex w-full items-center justify-between px-3 py-3 text-left text-sm font-medium text-slate-700">
            <span>Cài đặt nâng cao<span className="block text-xs font-normal text-slate-400">Hợp đồng, ngày nghỉ cố định, ngày vào làm / nghỉ việc</span></span><span aria-hidden="true">{advanced ? "▾" : "▸"}</span>
          </button>
          {advanced && <div className="space-y-6 border-t border-slate-100 px-3 py-4">
            <section className="space-y-3"><h4 className={sectionTitle}>Hợp đồng</h4>
              <p className="text-xs text-slate-500">Giờ theo tháng. Ngày vào/nghỉ việc tự điều chỉnh định mức của tháng đang chọn.</p>
              <span className={labelClass}>Số ngày làm / tuần <span className="font-normal text-slate-400">· Tự = tự động</span></span>
              <div className="grid grid-cols-7 gap-1">{["","1","2","3","4","5","6"].map(n=><button key={n || "auto"} type="button" aria-pressed={d.maxDays===n} onClick={()=>set("maxDays",n)} className={`rounded-md border py-2.5 text-sm font-medium ${d.maxDays===n ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600"}`}>{n || "Tự"}</button>)}</div>
            </section>
            <section className="space-y-3"><h4 className={sectionTitle}>Ngày nghỉ cố định</h4>
              <div className="grid grid-cols-7 gap-1">{WEEKDAY_ORDER.map(day=><button key={day} type="button" aria-pressed={daysOff.includes(day)} disabled={daysOff.length===6 && !daysOff.includes(day)} onClick={()=>toggleDayOff(day)} className={`rounded-md border py-2.5 text-sm font-medium disabled:opacity-40 ${daysOff.includes(day) ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600"}`}>{WEEKDAY_SHORT_VI[day]}</button>)}</div>
              <p className="text-xs text-slate-400">{daysOff.length ? `Không xếp ca vào ${daysOff.map(day=>WEEKDAY_SHORT_VI[day]).join(", ")}.` : "Không chọn = làm được mọi ngày quán mở."}</p>
            </section>
            <section className="space-y-3"><h4 className={sectionTitle}>Thời gian làm việc</h4>
              {!showPeriod ? <button type="button" onClick={()=>setShowPeriod(true)} className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-left text-sm text-slate-600">+ Ngày vào làm / nghỉ việc <span className="text-slate-400">(nếu không làm cả tháng)</span></button> : <>
                <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">{([['startDate','Ngày vào làm'],['endDate','Ngày nghỉ việc']] as const).map(([key,label])=><div key={key} className="min-w-0">
                  <div className={`${labelClass} flex justify-between`}><label htmlFor={`employee-${key}`}>{label}</label>{d[key] && <button type="button" onClick={()=>set(key,"")} className="font-normal underline">xoá</button>}</div>
                  <input id={`employee-${key}`} type="date" aria-invalid={!!periodError} aria-describedby={periodError ? "employee-period-error" : undefined} min={key==='endDate' ? d.startDate || undefined : undefined} max={key==='startDate' ? d.endDate || undefined : undefined} className={`${inputClass} block w-full min-w-0 max-w-full`} value={d[key]} onChange={e=>set(key,e.target.value)} />
                </div>)}</div>
                <p className="text-xs text-slate-400">Bỏ trống = từ đầu tháng / vẫn đang làm. Khi lưu, ca ngoài khoảng này sẽ được bỏ. Định mức tính theo số ngày quán mở, làm tròn giờ. Bấm Tạo lịch để phân bổ lại.</p>
              </>}
              {periodError && <p id="employee-period-error" role="alert" className="text-sm text-rose-600">{periodError}</p>}
            </section>
          </div>}
        </section>
      </div>
      <div className="shrink-0 border-t border-slate-200 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {confirmDelete ? <div className="flex items-center justify-between gap-3"><span className="text-sm text-slate-600">Xoá nhân viên này?</span><div className="flex gap-2"><button onClick={()=>setConfirmDelete(false)} className="rounded-lg px-4 py-2.5 text-sm">Không</button><button onClick={onDelete} className="rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-medium text-white">Xoá</button></div></div> : <div className="flex items-center gap-2">
          {onDelete && <button onClick={()=>setConfirmDelete(true)} className="rounded-lg px-3 py-2.5 text-sm font-medium text-rose-600 hover:bg-rose-50">Xoá</button>}
          <button onClick={onClose} className="ml-auto rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100">Huỷ</button>
          <button disabled={!d.name.trim() || !!periodError || hoursBad} onClick={()=>{if(d.name.trim() && !periodError && !hoursBad) onSave(draftToEmployee(d));}} className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40">Lưu</button>
        </div>}
      </div>
    </div>
  </div>;
}
