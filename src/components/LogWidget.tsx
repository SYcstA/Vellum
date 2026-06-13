import { useEffect } from "react";
import { Rnd } from "react-rnd";
import { useAppStore } from "../store/useAppStore";
import { glassStyle } from "../utils/glass";
import { clampWidgetPosition, useWidgetBoundaryClamp } from "../utils/window";

function LogWidget() {
  const logs = useAppStore((s) => s.logs);
  const refreshLogs = useAppStore((s) => s.refreshLogs);
  const widgetPos = useAppStore((s) => s.widgetPositions.log);
  const setWidgetPos = useAppStore((s) => s.setWidgetPosition);
  const widgetThemeColor = useAppStore((s) => s.widgetThemeColor);
  const widgetOpacity = useAppStore((s) => s.widgetOpacity);
  useWidgetBoundaryClamp("log", widgetPos, setWidgetPos);

  // Logged mutations always change one of these slices; refetch so the log stays live.
  const tasks = useAppStore((s) => s.tasks);
  const notes = useAppStore((s) => s.notes);
  const noteTaskLinks = useAppStore((s) => s.noteTaskLinks);
  const tags = useAppStore((s) => s.tags);

  useEffect(() => {
    refreshLogs();
  }, [refreshLogs, tasks, notes, noteTaskLinks, tags]);

  const isLight = widgetThemeColor === "light";
  const textPrimary = isLight ? "text-gray-800" : "text-white/90";
  const textSecondary = isLight ? "text-gray-500" : "text-white/50";
  const textTertiary = isLight ? "text-gray-400" : "text-white/30";
  const hoverBg = isLight ? "hover:bg-black/5" : "hover:bg-white/10";

  const actionColor: Record<string, string> = {
    TASK_CREATED: isLight ? "text-emerald-600" : "text-emerald-300",
    TASK_COMPLETED: isLight ? "text-sky-600" : "text-sky-300",
    TASK_REOPENED: isLight ? "text-amber-600" : "text-amber-300",
    SYSTEM: textTertiary,
  };

  return (
    <Rnd
      position={{ x: widgetPos?.x ?? 500, y: widgetPos?.y ?? 470 }}
      size={{ width: widgetPos?.width ?? 380, height: widgetPos?.height ?? 300 }}
      minWidth={300}
      minHeight={200}
      bounds="window"
      dragHandleClassName="drag-header"
      enableResizing={{ top: true, right: true, bottom: true, left: true, topRight: true, bottomRight: true, bottomLeft: true, topLeft: true }}
      onDragStop={(_e: any, d: { x: number; y: number }) => {
        const w = widgetPos?.width ?? 380;
        const h = widgetPos?.height ?? 300;
        const clamped = clampWidgetPosition(d.x, d.y, w, h);
        setWidgetPos("log", { x: clamped.x, y: clamped.y, width: w, height: h });
      }}
      onResizeStop={(_e: any, _dir: any, ref: any, _delta: any, position: { x: number; y: number }) => {
        const w = parseInt(ref.style.width, 10);
        const h = parseInt(ref.style.height, 10);
        const c = clampWidgetPosition(position.x, position.y, w, h);
        setWidgetPos("log", { x: c.x, y: c.y, width: w, height: h });
      }}
    >
      <div className="relative glass-noise w-full h-full rounded-2xl overflow-hidden flex flex-col" style={glassStyle(widgetThemeColor, widgetOpacity)}>
        <div className={`drag-header flex items-center justify-between px-4 py-3 bg-transparent border-b ${isLight ? "border-black/5" : "border-white/8"} select-none cursor-move`}>
          <span className={`text-[13px] font-semibold tracking-tight ${textPrimary}`}>Activity Log</span>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {logs.length === 0 && (
            <p className={`text-sm text-center pt-4 ${textTertiary}`}>No activity yet.</p>
          )}
          {logs.map((entry) => (
            <div key={entry.id} className={`p-2 rounded-lg bg-white/5 ${hoverBg} transition-colors`}>
              <div className="flex items-center justify-between gap-2">
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${actionColor[entry.actionType] || textSecondary}`}>
                  {entry.actionType.replace("_", " ")}
                </span>
                <span className={`text-[10px] font-mono ${textTertiary} shrink-0`}>{entry.timestamp}</span>
              </div>
              <p className={`text-xs ${isLight ? "text-gray-600" : "text-white/70"} mt-0.5`}>{entry.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </Rnd>
  );
}

export default LogWidget;