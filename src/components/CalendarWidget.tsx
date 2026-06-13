import { useState, useEffect, useRef, useMemo } from "react";
import { Rnd } from "react-rnd";
import { useAppStore } from "../store/useAppStore";
import { fetchTaskTitlesByDate } from "../store/db";
import { useLocalToday } from "../utils/date";
import { glassStyle } from "../utils/glass";
import { clampWidgetPosition, useWidgetBoundaryClamp } from "../utils/window";
import { ChevronLeft, ChevronRight, Check, X, Clock } from "lucide-react";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function CalendarWidget() {
  const tasks = useAppStore((s) => s.tasks);
  const activeDateFilter = useAppStore((s) => s.activeDateFilter);
  const setActiveDateFilter = useAppStore((s) => s.setActiveDateFilter);
  const today = useLocalToday();
  const widgetPos = useAppStore((s) => s.widgetPositions.calendar);
  const setWidgetPos = useAppStore((s) => s.setWidgetPosition);
  const widgetThemeColor = useAppStore((s) => s.widgetThemeColor);
  const widgetOpacity = useAppStore((s) => s.widgetOpacity);
  useWidgetBoundaryClamp("calendar", widgetPos, setWidgetPos);
  const isLight = widgetThemeColor === "light";
  const textPrimary = isLight ? "text-gray-900" : "text-white/90";

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [popup, setPopup] = useState<{
    date: string;
    completions: string[];
    deadlines: string[];
  } | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setPopup(null);
      }
    };
    if (popup) {
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }
  }, [popup]);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const prevMonth = () => {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else { setMonth((m) => m - 1); }
  };

  const nextMonth = () => {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else { setMonth((m) => m + 1); }
  };

  // Calendar indicators are derived directly from the SQL-backed task list
  // (single source of truth) and recompute reactively when tasks OR today change.
  // A deadline is "overdue" using the same rule as the To-Do list: not completed
  // and past today. Completed tasks show only their ✓ (deadline is resolved).
  const { completionDates, overdueDates, deadlineDates } = useMemo(() => {
    const completion = new Set<string>();
    const overdue = new Set<string>();
    const deadline = new Set<string>();
    for (const t of tasks) {
      if (t.completionDate) completion.add(t.completionDate);
      if (t.deadlineDate && !t.completed) {
        if (t.deadlineDate < today) overdue.add(t.deadlineDate);
        else deadline.add(t.deadlineDate);
      }
    }
    return { completionDates: completion, overdueDates: overdue, deadlineDates: deadline };
  }, [tasks, today]);

  const handleDateClick = async (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    // Drive the To-Do widget to focus this date (opens it + clears category filter),
    // and show the in-calendar preview popup.
    setActiveDateFilter(dateStr);
    const completions = await fetchTaskTitlesByDate(dateStr, "completion");
    const deadlines = await fetchTaskTitlesByDate(dateStr, "deadline");
    setPopup({ date: dateStr, completions, deadlines });
  };

  const cells: React.ReactNode[] = [];

  for (let i = 0; i < firstDay; i++) {
    cells.push(<div key={`empty-${i}`} />);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const hasCompletion = completionDates.has(dateStr);
    const hasOverdue = overdueDates.has(dateStr);
    const hasDeadline = deadlineDates.has(dateStr);
    const isToday = day === now.getDate() && month === now.getMonth() && year === now.getFullYear();
    const isSelected = dateStr === activeDateFilter;

    cells.push(
      <div
        key={day}
        onClick={() => handleDateClick(day)}
        className={`flex flex-col items-center justify-start pt-1.5 rounded-lg transition-colors min-h-11 cursor-pointer ${
          isSelected
            ? "bg-sky-500/25 ring-1 ring-sky-400/60"
            : isToday
            ? "bg-indigo-500/20 ring-1 ring-indigo-400/40"
            : "hover:bg-white/5"
        }`}
      >
        <span className={`text-xs font-mono ${isToday ? "text-indigo-200 font-semibold" : "text-white/60"}`}>
          {day}
        </span>
        {(hasCompletion || hasOverdue || hasDeadline) && (
          <div className="flex items-center gap-0.5 mt-0.5 leading-none">
            {hasCompletion && <Check size={11} strokeWidth={3} className="text-emerald-400" aria-label="Task completed" />}
            {hasOverdue && <span className="w-1.5 h-1.5 rounded-full bg-red-500" title="Overdue" />}
            {hasDeadline && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Deadline" />}
          </div>
        )}
      </div>
    );
  }

  // Centered on the viewed year so any year stays reachable via the dropdown.
  const yearOptions = Array.from({ length: 21 }, (_, i) => year - 10 + i);

  return (
    <Rnd
      position={{ x: widgetPos?.x ?? 500, y: widgetPos?.y ?? 50 }}
      size={{ width: widgetPos?.width ?? 360, height: widgetPos?.height ?? 390 }}
      minWidth={300}
      minHeight={340}
      bounds="window"
      dragHandleClassName="drag-header"
      enableResizing={{ top: true, right: true, bottom: true, left: true, topRight: true, bottomRight: true, bottomLeft: true, topLeft: true }}
      onDragStop={(_e: any, d: { x: number; y: number }) => {
        const w = widgetPos?.width ?? 360;
        const h = widgetPos?.height ?? 390;
        const clamped = clampWidgetPosition(d.x, d.y, w, h);
        setWidgetPos("calendar", { x: clamped.x, y: clamped.y, width: w, height: h });
      }}
      onResizeStop={(_e: any, _dir: any, ref: any, _delta: any, position: { x: number; y: number }) => {
        const w = parseInt(ref.style.width, 10);
        const h = parseInt(ref.style.height, 10);
        const c = clampWidgetPosition(position.x, position.y, w, h);
        setWidgetPos("calendar", { x: c.x, y: c.y, width: w, height: h });
      }}
    >
      <div className="relative glass-noise w-full h-full rounded-2xl overflow-hidden flex flex-col"
          style={glassStyle(widgetThemeColor, widgetOpacity)}
      >
        {/* Title bar (drag handle) */}
        <div className={`drag-header flex items-center px-4 py-3 bg-transparent border-b ${isLight ? "border-black/5" : "border-white/8"} select-none cursor-move`}>
          <span className={`text-[13px] font-semibold tracking-tight ${textPrimary}`}>Calendar</span>
        </div>

        {/* Month nav — arrows + instant jump-to selectors */}
        <div className="flex items-center justify-between px-3 pt-3 pb-1">
          <button onClick={prevMonth} title="Previous month" className="flex items-center justify-center w-6 h-6 rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-colors">
            <ChevronLeft size={15} strokeWidth={2} />
          </button>
          <div className="flex items-center gap-1">
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              title="Jump to month"
              className={`text-xs font-semibold tracking-tight bg-transparent outline-none cursor-pointer rounded-md px-1 py-0.5 hover:bg-white/10 transition-colors ${textPrimary}`}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i} className="text-gray-900">{m}</option>
              ))}
            </select>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              title="Jump to year"
              className={`text-xs font-mono bg-transparent outline-none cursor-pointer rounded-md px-1 py-0.5 hover:bg-white/10 transition-colors ${textPrimary}`}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y} className="text-gray-900">{y}</option>
              ))}
            </select>
          </div>
          <button onClick={nextMonth} title="Next month" className="flex items-center justify-center w-6 h-6 rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-colors">
            <ChevronRight size={15} strokeWidth={2} />
          </button>
        </div>

        {/* Calendar grid */}
        <div className="flex-1 px-3 pb-2 pt-1">
          <div className="grid grid-cols-7 mb-1">
            {DAYS.map((d) => (
              <div key={d} className="text-center text-[10px] font-medium text-white/30 uppercase tracking-wider py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">{cells}</div>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-3 px-3 pb-2">
          <div className="flex items-center gap-1.5">
            <Check size={11} strokeWidth={3} className="text-emerald-400" />
            <span className="text-[10px] text-white/40">Completed</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="text-[10px] text-white/40">Deadline</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-[10px] text-white/40">Overdue</span>
          </div>
        </div>

        {/* Date click popover */}
        {popup && (
          <div
            ref={popupRef}
            className="glass-noise absolute z-[100] rounded-xl p-3 inset-x-2 bottom-12"
            style={glassStyle(widgetThemeColor, Math.max(widgetOpacity, 0.9))}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono font-semibold text-white/80">{popup.date}</span>
              <button onClick={() => setPopup(null)} title="Close" className="text-white/40 hover:text-white/80 flex items-center"><X size={13} strokeWidth={2} /></button>
            </div>
            {popup.completions.length === 0 && popup.deadlines.length === 0 && (
              <p className="text-white/30 text-xs">No task activity on this date.</p>
            )}
            {popup.completions.length > 0 && (
              <div className="mb-2">
                <p className="flex items-center gap-1 text-[10px] font-semibold text-emerald-300 uppercase tracking-wider mb-1"><Check size={11} strokeWidth={3} /> Completed</p>
                {popup.completions.map((t, i) => (
                  <p key={i} className="text-xs text-white/70 ml-2">• {t}</p>
                ))}
              </div>
            )}
            {popup.deadlines.length > 0 && (
              <div>
                <p className="flex items-center gap-1 text-[10px] font-semibold text-amber-300 uppercase tracking-wider mb-1"><Clock size={11} strokeWidth={2} /> Deadlines</p>
                {popup.deadlines.map((t, i) => (
                  <p key={i} className="text-xs text-white/70 ml-2">• {t}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Rnd>
  );
}

export default CalendarWidget;