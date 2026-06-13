import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { glassStyle } from "../utils/glass";
import QuitModal from "./QuitModal";
import { ListTodo, CalendarDays, NotebookPen, ScrollText, Settings, Power, Minimize2 } from "lucide-react";

const dockItems = [
  { icon: ListTodo, name: "To-Do" as const },
  { icon: CalendarDays, name: "Calendar" as const },
  { icon: NotebookPen, name: "Notes" as const },
  { icon: ScrollText, name: "Log" as const },
];

function MasterDock() {
  const toggleToDo = useAppStore((s) => s.toggleToDo);
  const toggleCalendar = useAppStore((s) => s.toggleCalendar);
  const toggleNotes = useAppStore((s) => s.toggleNotes);
  const toggleLog = useAppStore((s) => s.toggleLog);
  const toggleSettings = useAppStore((s) => s.toggleSettings);
  const hideWindow = useAppStore((s) => s.hideWindow);
  const widgetThemeColor = useAppStore((s) => s.widgetThemeColor);
  const widgetOpacity = useAppStore((s) => s.widgetOpacity);
  const [showQuitModal, setShowQuitModal] = useState(false);

  const toggleMap: Record<string, () => void> = {
    "To-Do": toggleToDo,
    Calendar: toggleCalendar,
    Notes: toggleNotes,
    Log: toggleLog,
  };

  return (
    <>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
        <div className="relative glass-noise flex items-center gap-1 px-3 py-2 rounded-2xl" style={glassStyle(widgetThemeColor, widgetOpacity)}>
          {dockItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.name}
                onClick={toggleMap[item.name]}
                className="flex flex-col items-center gap-1 px-3 py-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-all duration-150 cursor-pointer min-w-14"
                title={item.name}
              >
                <Icon size={19} strokeWidth={1.75} />
                <span className="text-[10px] font-medium tracking-tight">{item.name}</span>
              </button>
            );
          })}
          <div className="w-px h-8 bg-white/10 mx-1" />
          <button
            onClick={hideWindow}
            className="flex flex-col items-center gap-1 px-3 py-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-all duration-150 cursor-pointer min-w-14"
            title="Hide to tray"
          >
            <Minimize2 size={19} strokeWidth={1.75} />
            <span className="text-[10px] font-medium tracking-tight">Hide</span>
          </button>
          <button
            onClick={toggleSettings}
            className="flex flex-col items-center gap-1 px-3 py-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-all duration-150 cursor-pointer min-w-14"
            title="Settings"
          >
            <Settings size={19} strokeWidth={1.75} />
            <span className="text-[10px] font-medium tracking-tight">Settings</span>
          </button>
          <button
            onClick={() => setShowQuitModal(true)}
            className="flex flex-col items-center gap-1 px-3 py-1.5 text-white/60 hover:text-red-400 hover:bg-white/10 rounded-lg transition-all duration-150 cursor-pointer min-w-14"
            title="Quit"
          >
            <Power size={19} strokeWidth={1.75} />
            <span className="text-[10px] font-medium tracking-tight">Quit</span>
          </button>
        </div>
      </div>
      <QuitModal open={showQuitModal} onCancel={() => setShowQuitModal(false)} />
    </>
  );
}

export default MasterDock;