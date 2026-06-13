import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { saveWindowState, StateFlags } from "@tauri-apps/plugin-window-state";
import { useAppStore } from "../store/useAppStore";
import { glassStyle } from "../utils/glass";

type QuitModalProps = {
  open: boolean;
  onCancel: () => void;
};

function QuitModal({ open, onCancel }: QuitModalProps) {
  const widgetThemeColor = useAppStore((s) => s.widgetThemeColor);
  const widgetOpacity = useAppStore((s) => s.widgetOpacity);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const isLight = widgetThemeColor === "light";

  useEffect(() => {
    if (open) setTimeout(() => confirmRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  if (!open) return null;

  const handleConfirm = async () => {
    try {
      // Flush window-state BEFORE process exit. kill_app is a hard std::process::exit(0)
      // that bypasses the plugin's normal CloseRequested save hook, so without this
      // explicit save the next launch wouldn't remember the last size/position.
      try { await saveWindowState(StateFlags.SIZE | StateFlags.POSITION); }
      catch (err) { console.error("saveWindowState pre-quit failed:", err); }
      await invoke("kill_app");
    } catch {
      // Ultimate fallback
      window.close();
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="relative glass-noise rounded-2xl p-5 w-80" style={glassStyle(widgetThemeColor, Math.max(widgetOpacity, 0.92))}>
        <p className={`text-sm font-semibold mb-2 ${isLight ? "text-gray-900" : "text-white/90"}`}>
          Confirm Exit
        </p>
        <p className={`text-xs mb-4 ${isLight ? "text-gray-500" : "text-white/60"}`}>
          Are you sure you want to quit the app?
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${isLight ? "text-gray-500 hover:text-gray-800 bg-gray-100" : "text-white/50 hover:text-white/80 bg-white/5"}`}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={handleConfirm}
            className="text-xs font-medium text-white bg-red-500/50 hover:bg-red-500/70 transition-colors px-4 py-1.5 rounded-lg"
          >
            Quit
          </button>
        </div>
      </div>
    </div>
  );
}

export default QuitModal;