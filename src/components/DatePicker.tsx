import { useState, useRef, useEffect } from "react";
import { useLocalToday } from "../utils/date";
import { createPortal } from "react-dom";
import { useAppStore } from "../store/useAppStore";
import { glassStyle } from "../utils/glass";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

type DatePickerProps = {
  value: string;
  onChange: (date: string) => void;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function DatePicker({ value, onChange }: DatePickerProps) {
  const widgetThemeColor = useAppStore((s) => s.widgetThemeColor);
  const widgetOpacity = useAppStore((s) => s.widgetOpacity);
  const [open, setOpen] = useState(false);
  const now = value ? new Date(value) : new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const btnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0, width: 220 });

  const isLight = widgetThemeColor === "light";

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node) &&
          btnRef.current && !btnRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const prevMonth = () => {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  };

  const handleSelect = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    onChange(dateStr);
    setOpen(false);
  };

  const clearDate = () => { onChange(""); setOpen(false); };

  const toggleOpen = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPopupPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(220, rect.width) });
    }
    setOpen(!open);
  };

  const displayValue = value
    ? `${value.slice(8, 10)} ${MONTHS[parseInt(value.slice(5, 7), 10) - 1].slice(0, 3)} ${value.slice(0, 4)}`
    : "Deadline";

  const txtMuted = isLight ? "text-gray-400" : "text-white/40";
  const txtBody = isLight ? "text-gray-900" : "text-white/80";
  // Year range centered on the viewed year so any year stays reachable.
  const yearOptions = Array.from({ length: 21 }, (_, i) => year - 10 + i);

  const todayStr = useLocalToday();
  const cells: React.ReactNode[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(<div key={`e-${i}`} />);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const isSel = dateStr === value;
    const isToday = dateStr === todayStr;
    cells.push(
      <button key={d} onClick={() => handleSelect(d)} title={isToday ? "Today" : undefined}
        className={`text-xs rounded-lg py-1 transition-colors ${isToday ? "ring-1 ring-indigo-400/80 font-semibold" : ""} ${isSel ? "bg-indigo-500/40 text-indigo-200" : `${txtBody} hover:bg-white/10`}`}>
        {d}
      </button>
    );
  }

  return (
    <div className="relative" ref={popupRef}>
      <button ref={btnRef} onClick={toggleOpen}
        className={`w-full flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border text-left ${isLight ? "bg-white/50 border-gray-300 text-gray-700" : "bg-white/5 border-white/10 text-white/70"} transition-colors`}
      >
        <CalendarDays size={13} strokeWidth={1.75} className="shrink-0" />
        {displayValue}
      </button>
      {open && createPortal(
        <div
          className="glass-noise fixed z-[9999] rounded-xl p-2"
          style={{ ...glassStyle(widgetThemeColor, Math.max(widgetOpacity, 0.92)), top: popupPos.top, left: popupPos.left, width: popupPos.width }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-1">
            <button onClick={prevMonth} title="Previous month" className={`${txtMuted} hover:opacity-80 flex items-center px-1`}><ChevronLeft size={14} strokeWidth={2} /></button>
            <div className="flex items-center gap-1">
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                title="Jump to month"
                className={`text-xs font-medium bg-transparent outline-none cursor-pointer rounded-md px-1 py-0.5 hover:bg-white/10 transition-colors ${txtBody}`}
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i} className="text-gray-900">{m}</option>
                ))}
              </select>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                title="Jump to year"
                className={`text-xs font-mono bg-transparent outline-none cursor-pointer rounded-md px-1 py-0.5 hover:bg-white/10 transition-colors ${txtBody}`}
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y} className="text-gray-900">{y}</option>
                ))}
              </select>
            </div>
            <button onClick={nextMonth} title="Next month" className={`${txtMuted} hover:opacity-80 flex items-center px-1`}><ChevronRight size={14} strokeWidth={2} /></button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {["Su","Mo","Tu","We","Th","Fr","Sa"].map((d) => (
              <div key={d} className={`text-center text-[10px] ${txtMuted} py-0.5`}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">{cells}</div>
          {value && (
            <button onClick={clearDate} className={`w-full text-[10px] mt-1 ${txtMuted} hover:opacity-80 py-1`}>Clear</button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

export default DatePicker;