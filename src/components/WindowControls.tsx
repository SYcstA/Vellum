import { useState, useEffect } from "react";
import {
  getCurrentWindow,
} from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../store/useAppStore";
import { glassStyle } from "../utils/glass";
import { fakeMaximize, restoreWindow, isFakeMaximized } from "../utils/window";
import QuitModal from "./QuitModal";
import { prettyShortcut } from "../utils/shortcut";
import { Ghost, Minus, Square, Copy, X } from "lucide-react";

function WindowControls() {
  const widgetThemeColor = useAppStore((s) => s.widgetThemeColor);
  const widgetOpacity = useAppStore((s) => s.widgetOpacity);
  const ghostShortcut = useAppStore((s) => s.ghostShortcut);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [isMaximized, setIsMaximized] = useState(isFakeMaximized());
  const [ghost, setGhost] = useState(false);

  useEffect(() => {
    const unlisten = listen<boolean>("ghost-mode-changed", (e) => setGhost(e.payload));
    return () => { unlisten.then((un) => un()); };
  }, []);

  const isLight = widgetThemeColor === "light";
  const txtBtn = isLight ? "text-gray-600 hover:text-gray-900" : "text-white/50 hover:text-white";

  const handleHide = async () => {
    try {
      await invoke("update_tray_text", { text: "Show Dashboard" });
      await getCurrentWindow().hide();
    } catch {}
  };

  const handleMaximize = async () => {
    try {
      if (isFakeMaximized()) {
        await restoreWindow();
        setIsMaximized(false);
      } else {
        await fakeMaximize();
        setIsMaximized(true);
      }
    } catch (err) {
      console.error("maximize toggle failed:", err);
    }
  };

  const handleGhost = async () => {
    try {
      await invoke("set_ghost_mode", { enabled: true });
    } catch (err) {
      console.error("ghost mode toggle failed:", err);
    }
  };

  return (
    <>
      <div className="fixed top-3 right-3 z-[9999]">
        <div
          className="relative glass-noise flex items-center gap-0.5 px-1.5 py-1 rounded-xl"
          style={glassStyle(widgetThemeColor, widgetOpacity)}
        >
          <div className="relative group">
            <button onClick={handleGhost} className={`${ghost ? "text-sky-300" : txtBtn} flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/10`} title={`Ghost Mode — make the window click-through (Press ${prettyShortcut(ghostShortcut)} to exit)`}><Ghost size={15} strokeWidth={1.75} /></button>
            <div className="absolute top-full right-0 mt-1.5 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap">
              <div className="glass-noise relative rounded-md px-2 py-1 text-[10px] font-mono tracking-tight text-white/80" style={glassStyle(widgetThemeColor, Math.max(widgetOpacity, 0.9))}>
                Ghost Mode · {prettyShortcut(ghostShortcut)} to exit
              </div>
            </div>
          </div>
          <button onClick={handleHide} className={`${txtBtn} flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/10`} title="Hide to tray"><Minus size={15} strokeWidth={2} /></button>
          <button onClick={handleMaximize} className={`${txtBtn} flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/10`} title={isMaximized ? "Restore" : "Maximize"}>{isMaximized ? <Copy size={13} strokeWidth={1.75} /> : <Square size={13} strokeWidth={1.75} />}</button>
          <button onClick={() => setShowQuitModal(true)} className={`${txtBtn} flex items-center justify-center w-7 h-7 rounded-lg hover:bg-red-500/30 hover:text-white`} title="Quit"><X size={15} strokeWidth={2} /></button>
        </div>
      </div>
      {/* Ghost Mode indicator: a click-through window can't take clicks, so show
          a non-interactive badge with the exit hint (tray menu also exits). */}
      {ghost && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none select-none">
          <div className="glass-noise relative rounded-full px-4 py-2 text-xs font-mono text-sky-200 animate-pulse" style={glassStyle(widgetThemeColor, Math.max(widgetOpacity, 0.9))}>
            Ghost Mode ON · press {prettyShortcut(ghostShortcut)} or use tray to exit
          </div>
        </div>
      )}
      <QuitModal open={showQuitModal} onCancel={() => setShowQuitModal(false)} />
    </>
  );
}

export default WindowControls;
