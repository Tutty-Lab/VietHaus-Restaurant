import { useState } from "react";
import { useSchedule } from "./hooks/useSchedule";
import { SettingsTab } from "./components/SettingsTab";
import { EmployeesTab } from "./components/EmployeesTab";
import { ScheduleTab } from "./components/ScheduleTab";
import { StundenzettelTab } from "./components/StundenzettelTab";
import { DocsTab } from "./components/DocsTab";
import { Dashboard } from "./components/Dashboard";
import { LockScreen } from "./components/LockScreen";
import { isAuthenticated, logout } from "./lib/auth";
import { MONTH_NAMES_VI } from "./lib/dateFormat";

type TabId = "einstellungen" | "mitarbeiter" | "dienstplan" | "stundenzettel";

/**
 * Sichtbar als Tab sind die drei, mit denen täglich gearbeitet wird
 * (MAIN_TABS); Cài đặt und Tài liệu stecken im Menü ☰ oben rechts (wie die Demo).
 */
const TABS: { id: TabId; label: string }[] = [
  { id: "stundenzettel", label: "Chấm công" },
  { id: "dienstplan", label: "Lịch" },
  { id: "mitarbeiter", label: "Nhân viên" },
  { id: "einstellungen", label: "Cài đặt" },
];
const MAIN_TABS: TabId[] = ["stundenzettel", "dienstplan", "mitarbeiter"];

export default function App() {
  const [unlocked, setUnlocked] = useState(() => isAuthenticated());

  if (!unlocked) return <LockScreen onUnlock={() => setUnlocked(true)} />;
  return <MainApp onLogout={() => setUnlocked(false)} />;
}

function MainApp({ onLogout }: { onLogout: () => void }) {
  const store = useSchedule();
  const { schedule } = store;
  const [tab, setTab] = useState<TabId>("stundenzettel");
  const [menuOpen, setMenuOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  /** Steigt bei jedem Klick auf „Tạo lịch"; ScheduleTab startet dann seinen Ablauf. */
  const [genSignal, setGenSignal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refreshApp = async () => {
    setRefreshing(true);
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      // Höchstens 3 s auf die Update-Prüfung warten (schlechtes Netz).
      await Promise.race([reg?.update(), new Promise((resolve) => setTimeout(resolve, 3000))]);
    } catch {
      // egal – trotzdem neu laden
    }
    window.location.reload();
  };

  const openTab = (id: TabId) => {
    setTab(id);
    setDocsOpen(false);
  };

  const thisYear = new Date().getFullYear();
  const years = Array.from(new Set([schedule.year, ...Array.from({ length: 7 }, (_, i) => thisYear - 1 + i)])).sort();

  return (
    <div className="min-h-screen">
      {/* iPhone-App vom Home-Bildschirm (black-translucent): Inhalt unter die Statusleiste schieben. */}
      <header className="no-print bg-slate-900 text-white shadow sticky top-0 z-30 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto max-w-[1500px] px-3 sm:px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-base sm:text-lg font-semibold">Lịch làm việc &amp; Bảng chấm công</h1>
            {store.remoteStatus === "error" && (
              <p className="text-xs text-rose-300">Lỗi đồng bộ — dữ liệu chỉ lưu trên máy này</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Aus dem Menü geöffnete Seite: steht direkt neben dem Menü, mit ✕ zurück. */}
            {(docsOpen || !MAIN_TABS.includes(tab)) && (
              <span className="inline-flex items-center gap-1 rounded-md bg-white py-1.5 pl-3 pr-1 text-sm font-medium text-slate-900">
                {docsOpen ? "Tài liệu" : TABS.find((t) => t.id === tab)?.label}
                <button
                  type="button"
                  onClick={() => openTab("stundenzettel")}
                  aria-label="Đóng"
                  className="rounded px-1.5 text-slate-400 hover:text-slate-900"
                >
                  ✕
                </button>
              </span>
            )}
            {/* Tải lại: als App vom Home-Bildschirm gibt es keine Browserleiste zum Neuladen. */}
            <button
              type="button"
              onClick={() => void refreshApp()}
              disabled={refreshing}
              aria-label="Tải lại"
              title="Tải lại"
              className="flex h-9 w-9 items-center justify-center rounded bg-slate-700 text-lg leading-none hover:bg-slate-600 disabled:opacity-60"
            >
              <span className={refreshing ? "inline-block animate-spin" : "inline-block"}>↻</span>
            </button>
            {/* Menu: alles, was nicht täglich gebraucht wird. */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                className={`rounded px-3 py-2 text-sm font-medium ${menuOpen ? "bg-white text-slate-900" : "bg-slate-700 hover:bg-slate-600"}`}
              >
                ☰ Menu
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div
                    role="menu"
                    className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-sm text-slate-800 shadow-lg"
                  >
                    {(
                      [
                        ["Cài đặt", () => openTab("einstellungen")],
                        ["Tài liệu", () => setDocsOpen(true)],
                        [
                          "Đăng xuất",
                          () => {
                            logout();
                            onLogout();
                          },
                        ],
                      ] as const
                    ).map(([label, action]) => (
                      <button
                        key={label}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          action();
                          setMenuOpen(false);
                        }}
                        className="block w-full px-4 py-2 text-left hover:bg-slate-50"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="no-print mx-auto max-w-[1500px] px-3 sm:px-4 pt-4">
        <Dashboard store={store} />
      </div>

      <nav className="no-print mx-auto max-w-[1500px] px-3 sm:px-4 mt-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* Chấm công · Lịch · Nhân viên als Segment; Tháng + Tạo lịch rechts. */}
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5">
            {TABS.filter((t) => MAIN_TABS.includes(t.id)).map((t) => {
              const active = !docsOpen && tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => openTab(t.id)}
                  aria-current={active ? "page" : undefined}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
                    active ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <select
              aria-label="Tháng"
              value={`${schedule.year}-${schedule.month}`}
              onChange={(e) => {
                const [year, month] = e.target.value.split("-").map(Number);
                store.updateMeta({ year, month });
              }}
              className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-800"
            >
              {years.flatMap((year) =>
                MONTH_NAMES_VI.map((name, i) => (
                  <option key={`${year}-${i + 1}`} value={`${year}-${i + 1}`}>
                    {name}/{year}
                  </option>
                )),
              )}
            </select>
            {/* „Tạo lịch" – wichtigste Aktion: öffnet im Tab Lịch die Urlaubs-Abfrage, dann wird erzeugt. */}
            <button
              type="button"
              onClick={() => {
                openTab("dienstplan");
                setGenSignal((n) => n + 1);
              }}
              disabled={schedule.employees.length === 0}
              className="whitespace-nowrap rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-40"
            >
              Tạo lịch
            </button>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-[1500px] px-3 sm:px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="no-print">
          {docsOpen && <DocsTab />}
          {!docsOpen && tab === "einstellungen" && <SettingsTab store={store} />}
          {!docsOpen && tab === "mitarbeiter" && <EmployeesTab store={store} />}
        </div>
        {/*
          „Chấm công" enthält den Druckbereich (Stundenzettel UND Dienstplan)
          und darf deshalb NICHT im no-print-Container liegen: der wird beim
          Drucken auf display:none gesetzt, und ein Kind kann das nicht
          zurücknehmen. Der Tab blendet seine Bedienelemente selbst aus.
        */}
        {!docsOpen && tab === "dienstplan" && <ScheduleTab store={store} startSignal={genSignal} onStarted={() => setGenSignal(0)} />}
        {!docsOpen && tab === "stundenzettel" && <StundenzettelTab store={store} />}
      </main>
    </div>
  );
}
