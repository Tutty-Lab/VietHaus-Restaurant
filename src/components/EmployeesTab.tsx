import { useMemo, useState } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import type { Employee, EmploymentType } from "../types";
import { splitTargetHours } from "../lib/splitTargetHours";
import { WEEKDAY_SHORT_VI, type WeekdayKey } from "../lib/demand";
import { employmentShortVi } from "../lib/employment";

const inputClass =
  "rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";

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
};

function draftFrom(emp?: Employee): Draft {
  return {
    name: emp?.name ?? "",
    employmentType: emp?.employmentType ?? "VOLLZEIT",
    hours: emp ? String(emp.targetMinutes / 60) : "176",
    availableWeekdays: emp?.availableWeekdays ?? [],
    maxDays: emp?.maxDaysPerWeek ? String(emp.maxDaysPerWeek) : "",
  };
}

function draftToEmployee(d: Draft): Omit<Employee, "id"> {
  const stunden = Math.max(0, Math.round(Number(d.hours) || 0));
  const tage = Number(d.maxDays);
  return {
    name: d.name.trim() || "Nhân viên mới",
    employmentType: d.employmentType,
    targetMinutes: stunden * 60,
    availableWeekdays:
      d.availableWeekdays.length === 0 || d.availableWeekdays.length === 7
        ? undefined
        : [...d.availableWeekdays],
    maxDaysPerWeek: d.maxDays === "" || tage < 1 ? undefined : Math.min(7, Math.round(tage)),
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
                <EmployeeSummaryRow emp={emp} />
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

function EmployeeSummaryRow({ emp }: { emp: Employee }) {
  const stunden = emp.targetMinutes / 60;
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
          {stunden}h · <span className={info.ok ? "" : "text-rose-600"}>{info.text}</span>
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

function EmployeeSheet({
  employee,
  onClose,
  onSave,
  onDelete,
}: {
  employee?: Employee;
  onClose: () => void;
  onSave: (felder: Omit<Employee, "id">) => void;
  onDelete?: () => void;
}) {
  const [d, setD] = useState<Draft>(() => draftFrom(employee));
  const [loeschFrage, setLoeschFrage] = useState(false);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((prev) => ({ ...prev, [k]: v }));

  const stunden = Math.max(0, Math.round(Number(d.hours) || 0));
  const info = splitInfo(stunden, d.employmentType);
  const tooMany = stunden > WARN_HOURS;

  const alleTage = d.availableWeekdays.length === 0;
  const toggleWeekday = (key: WeekdayKey) => {
    const basis = alleTage ? WEEKDAY_ORDER : d.availableWeekdays;
    set(
      "availableWeekdays",
      basis.includes(key) ? basis.filter((k) => k !== key) : [...basis, key],
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-lg bg-white shadow-xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">
            {employee ? "Sửa nhân viên" : "Thêm nhân viên"}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">
            ✕
          </button>
        </div>

        <div className="px-4 py-3 space-y-4">
          <label className="block">
            <span className="text-xs text-slate-600">Tên</span>
            <input
              autoFocus={!employee}
              className={`${inputClass} w-full mt-1`}
              value={d.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Tên nhân viên"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-slate-600">Hình thức</span>
              <select
                className={`${inputClass} w-full mt-1`}
                value={d.employmentType}
                onChange={(e) => set("employmentType", e.target.value as EmploymentType)}
              >
                <option value="VOLLZEIT">Toàn thời gian</option>
                <option value="TEILZEIT">Bán thời gian</option>
                <option value="MINIJOB">Minijob</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-600">Giờ định mức / tháng</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                className={`${inputClass} w-full mt-1`}
                value={d.hours}
                onChange={(e) => set("hours", e.target.value)}
              />
            </label>
          </div>
          <div className={`text-xs ${info.ok ? "text-slate-500" : "text-rose-600"}`}>
            {info.text}
            {tooMany && <span className="text-amber-600 font-medium"> · ⚠ &gt;{WARN_HOURS}h/tháng</span>}
          </div>

          <div className="border-t border-slate-100 pt-3">
            <div className="text-xs text-slate-600 mb-1.5">
              Ngày làm trong tuần
              {alleTage && <span className="text-slate-400"> — bỏ trống = làm mọi ngày</span>}
            </div>
            <div className="flex flex-wrap gap-1">
              {WEEKDAY_ORDER.map((key) => {
                const an = alleTage || d.availableWeekdays.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleWeekday(key)}
                    className={`rounded px-2 py-1 text-xs border transition-colors ${
                      an
                        ? "bg-slate-800 text-white border-slate-800"
                        : "bg-white text-slate-400 border-slate-200 line-through"
                    }`}
                  >
                    {WEEKDAY_SHORT_VI[key]}
                  </button>
                );
              })}
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
              Số ngày làm mỗi tuần
              <input
                type="number"
                min={1}
                max={7}
                placeholder="—"
                className={`${inputClass} w-16`}
                value={d.maxDays}
                onChange={(e) => set("maxDays", e.target.value)}
              />
              <span className="text-slate-400">bỏ trống = không giới hạn</span>
            </label>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-slate-200 px-4 py-3">
          {loeschFrage ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-600">Xoá nhân viên này?</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setLoeschFrage(false)}
                  className="rounded px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Không
                </button>
                <button
                  onClick={onDelete}
                  className="rounded bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700"
                >
                  Xoá
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              {onDelete ? (
                <button
                  onClick={() => setLoeschFrage(true)}
                  className="text-rose-600 hover:text-rose-800 text-sm font-medium"
                >
                  Xoá
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  Huỷ
                </button>
                <button
                  onClick={() => onSave(draftToEmployee(d))}
                  className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
                >
                  Lưu
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
