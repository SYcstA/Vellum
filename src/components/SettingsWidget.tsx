import { useState, useEffect } from "react";
import { Rnd } from "react-rnd";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store/useAppStore";
import { glassStyle } from "../utils/glass";
import { clampWidgetPosition, useWidgetBoundaryClamp } from "../utils/window";
import { X, Check, Trash2 } from "lucide-react";
import ConfirmModal from "./ConfirmModal";
import { acceleratorFromEvent, prettyShortcut, DEFAULT_GHOST_SHORTCUT } from "../utils/shortcut";

function SettingsWidget() {
  const toggleSettings = useAppStore((s) => s.toggleSettings);
  const resetAllData = useAppStore((s) => s.resetAllData);
  const widgetThemeColor = useAppStore((s) => s.widgetThemeColor);
  const setWidgetThemeColor = useAppStore((s) => s.setWidgetThemeColor);
  const widgetOpacity = useAppStore((s) => s.widgetOpacity);
  const setWidgetOpacity = useAppStore((s) => s.setWidgetOpacity);
  const widgetPos = useAppStore((s) => s.widgetPositions.settings);
  const setWidgetPos = useAppStore((s) => s.setWidgetPosition);
  const wallpaperPath = useAppStore((s) => s.wallpaperPath);
  const setWallpaperPath = useAppStore((s) => s.setWallpaperPath);
  const ghostShortcut = useAppStore((s) => s.ghostShortcut);
  const setGhostShortcut = useAppStore((s) => s.setGhostShortcut);
  useWidgetBoundaryClamp("settings", widgetPos, setWidgetPos);

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  const [capturingShortcut, setCapturingShortcut] = useState(false);
  const [shortcutError, setShortcutError] = useState("");

  const [shortcutPreview, setShortcutPreview] = useState("");

  const applyShortcut = async (acc: string) => {
    try {
      await invoke("set_ghost_shortcut", { accelerator: acc });
      setGhostShortcut(acc);
      setShortcutError("");
      setCapturingShortcut(false);
      setShortcutPreview("");
    } catch (err) {
      setShortcutError(String(err));
    }
  };

  // Esc cancels; otherwise build the accelerator from the pressed combo and show
  // the held modifiers live so the user sees what is being captured.
  const captureShortcut = async (e: React.KeyboardEvent) => {
    e.preventDefault();
    if (e.key === "Escape") { setCapturingShortcut(false); setShortcutPreview(""); setShortcutError(""); return; }
    const r = acceleratorFromEvent(e.nativeEvent);
    setShortcutPreview(r.preview);
    if (r.error) { setShortcutError(r.error); return; }
    if (r.acc) await applyShortcut(r.acc);
  };

  const handleBrowseWallpaper = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }],
      });
      if (typeof selected === "string") setWallpaperPath(selected);
    } catch (err) {
      console.error("Wallpaper selection failed:", err);
    }
  };

  // Sync the toggle to the plugin's real state every time the widget opens —
  // covers cases where the user enabled autostart via OS or a previous session.
  useEffect(() => {
    isEnabled()
      .then(setAutoStartEnabled)
      .catch((err) => console.error("isEnabled() failed:", err));
  }, []);

  const handleToggleAutoStart = async () => {
    try {
      if (autoStartEnabled) await disable();
      else await enable();
      // Re-query authoritative state — never trust the optimistic flip alone.
      const actual = await isEnabled();
      setAutoStartEnabled(actual);
    } catch (err) {
      console.error("Autostart toggle failed:", err);
      // Resync on failure too.
      try { setAutoStartEnabled(await isEnabled()); }
      catch (resyncErr) { console.error("Autostart resync failed:", resyncErr); }
    }
  };

  const handleFactoryReset = async () => {
    await resetAllData();
    setShowResetConfirm(false);
    toggleSettings();
  };

  const isLight = widgetThemeColor === "light";
  const textPrimary = isLight ? "text-gray-900" : "text-white/90";
  const textSecondary = isLight ? "text-gray-500" : "text-white/50";

  return (
    <>
      <Rnd
        position={{ x: widgetPos?.x ?? 50, y: widgetPos?.y ?? 480 }}
        size={{ width: widgetPos?.width ?? 320, height: widgetPos?.height ?? 300 }}
        minWidth={280} minHeight={260}
        bounds="window"
        dragHandleClassName="drag-header"
        enableResizing={{ top: true, right: true, bottom: true, left: true, topRight: true, bottomRight: true, bottomLeft: true, topLeft: true }}
        onDragStop={(_e: any, d: { x: number; y: number }) => {
        const w = widgetPos?.width ?? 320;
        const h = widgetPos?.height ?? 300;
        const clamped = clampWidgetPosition(d.x, d.y, w, h);
        setWidgetPos("settings", { x: clamped.x, y: clamped.y, width: w, height: h });
      }}
        onResizeStop={(_e: any, _dir: any, ref: any, _delta: any, position: { x: number; y: number }) => {
          const w = parseInt(ref.style.width, 10);
          const h = parseInt(ref.style.height, 10);
          const c = clampWidgetPosition(position.x, position.y, w, h);
          setWidgetPos("settings", { x: c.x, y: c.y, width: w, height: h });
        }}
      >
        <div className="relative glass-noise w-full h-full rounded-2xl overflow-hidden flex flex-col" style={glassStyle(widgetThemeColor, widgetOpacity)}>
          <div className={`drag-header flex items-center justify-between px-4 py-3 bg-transparent border-b ${isLight ? "border-black/5" : "border-white/8"} select-none cursor-move`}>
            <span className={`text-[13px] font-semibold tracking-tight ${textPrimary}`}>Settings</span>
            <button onClick={toggleSettings} className={`${isLight ? "text-gray-500 hover:text-gray-800" : "text-white/40 hover:text-white/80"} transition-colors flex items-center`} title="Close"><X size={14} strokeWidth={2} /></button>
          </div>
          <div className="flex-1 p-4 space-y-4 overflow-y-auto">
            {/* Widget Theme */}
            <div>
              <p className={`text-xs ${textSecondary} mb-2`}>Widget Theme</p>
              <div className="flex gap-1">
                {(["dark", "light", "pure-black"] as const).map((c) => (
                  <button key={c} onClick={() => setWidgetThemeColor(c)}
                    className={`flex-1 text-xs font-medium transition-colors px-2 py-1.5 rounded-lg border ${widgetThemeColor === c ? "bg-indigo-500/30 text-indigo-200 border-indigo-400/40" : `${isLight ? "bg-gray-100 text-gray-600 border-gray-300" : "bg-white/5 text-white/60 border-white/10"} hover:border-white/30`}`}>
                    {c === "dark" ? "Glass" : c === "light" ? "Light" : "Pure Black"}
                  </button>
                ))}
              </div>
            </div>
            {/* Widget Opacity */}
            <div>
              <p className={`text-xs ${textSecondary} mb-2`}>Widget Opacity</p>
              <input type="range" min={0.1} max={1.0} step={0.05} value={widgetOpacity} onChange={(e) => setWidgetOpacity(Number(e.target.value))} className="w-full accent-indigo-500" title="Adjust widget opacity" />
              <div className="flex justify-between text-[10px] mt-0.5"><span className={isLight ? "text-gray-400" : "text-white/30"}>Transparent</span><span className={`font-mono ${textPrimary}`}>{Math.round(widgetOpacity * 100)}%</span><span className={isLight ? "text-gray-400" : "text-white/30"}>Solid</span></div>
            </div>
            {/* Wallpaper */}
            <div>
              <p className={`text-xs ${textSecondary} mb-2`}>Wallpaper</p>
              <div className="flex gap-1.5">
                <button onClick={handleBrowseWallpaper} className={`flex-1 text-xs font-medium transition-colors px-3 py-2 rounded-lg border ${isLight ? "bg-gray-100 text-gray-700 border-gray-300 hover:border-gray-400" : "bg-white/5 text-white/70 border-white/10 hover:border-white/30"}`}>
                  {wallpaperPath ? "Change Image…" : "Choose Image…"}
                </button>
                {wallpaperPath && (
                  <button onClick={() => setWallpaperPath(null)} title="Remove custom wallpaper" className={`text-xs font-medium transition-colors px-3 py-2 rounded-lg border ${isLight ? "bg-gray-100 text-gray-500 border-gray-300 hover:text-gray-800" : "bg-white/5 text-white/50 border-white/10 hover:text-white/90 hover:border-white/30"}`}>
                    Reset
                  </button>
                )}
              </div>
              {wallpaperPath && (
                <p className={`text-[10px] mt-1.5 truncate ${isLight ? "text-gray-400" : "text-white/30"}`} title={wallpaperPath}>{wallpaperPath}</p>
              )}
            </div>
            {/* Autostart */}
            <div>
              <p className={`text-xs ${textSecondary} mb-2`}>Startup</p>
              <button onClick={handleToggleAutoStart} className={`w-full flex items-center justify-center gap-1.5 text-xs font-medium transition-colors px-3 py-2 rounded-lg border ${autoStartEnabled ? "text-emerald-300 bg-emerald-500/20 border-emerald-500/30" : `${isLight ? "bg-gray-100 text-gray-600 border-gray-300" : "bg-white/5 text-white/60 border-white/10 hover:border-white/30"}`}`}>
                {autoStartEnabled && <Check size={13} strokeWidth={2.5} />}Launch on System Startup
              </button>
            </div>
            {/* Ghost Mode Shortcut */}
            <div>
              <p className={`text-xs ${textSecondary} mb-2`}>Ghost Mode Shortcut</p>
              <div className="flex gap-1.5">
                <button
                  onKeyDown={capturingShortcut ? captureShortcut : undefined}
                  onClick={() => { setCapturingShortcut(true); setShortcutError(""); setShortcutPreview(""); }}
                  onBlur={() => { setCapturingShortcut(false); setShortcutPreview(""); }}
                  className={`flex-1 text-xs font-medium transition-colors px-3 py-2 rounded-lg border ${capturingShortcut ? "bg-indigo-500/30 text-indigo-200 border-indigo-400/60" : `${isLight ? "bg-gray-100 text-gray-700 border-gray-300 hover:border-gray-400" : "bg-white/5 text-white/70 border-white/10 hover:border-white/30"}`}`}
                >
                  <span className="font-mono">{capturingShortcut ? (shortcutPreview || "Press your combo…") : prettyShortcut(ghostShortcut)}</span>
                </button>
                {ghostShortcut !== DEFAULT_GHOST_SHORTCUT && !capturingShortcut && (
                  <button onClick={() => applyShortcut(DEFAULT_GHOST_SHORTCUT)} title={`Reset to ${prettyShortcut(DEFAULT_GHOST_SHORTCUT)}`}
                    className={`text-xs font-medium transition-colors px-3 py-2 rounded-lg border ${isLight ? "bg-gray-100 text-gray-500 border-gray-300 hover:text-gray-800" : "bg-white/5 text-white/50 border-white/10 hover:text-white/90 hover:border-white/30"}`}>Reset</button>
                )}
              </div>
              <p className={`text-[10px] mt-1 ${isLight ? "text-gray-400" : "text-white/30"}`}>
                {capturingShortcut ? "Esc to cancel." : "Click, then press the new combo."}
              </p>
              {shortcutError && <p className="text-[10px] text-red-400 mt-1">{shortcutError}</p>}
            </div>
            {/* Danger Zone */}
            <div>
              <p className={`text-xs ${textSecondary} mb-2`}>Danger Zone</p>
              <button onClick={() => setShowResetConfirm(true)} className="w-full flex items-center justify-center gap-1.5 text-xs font-medium text-red-300 bg-red-500/20 hover:bg-red-500/30 transition-colors px-3 py-2 rounded-lg border border-red-500/30"><Trash2 size={13} strokeWidth={1.75} /> Factory Reset — Delete All Data</button>
            </div>
          </div>
        </div>
      </Rnd>
      <ConfirmModal open={showResetConfirm} title="Factory Reset" message="Are you sure you want to delete ALL data? This action cannot be undone." confirmLabel="Delete Everything" onConfirm={handleFactoryReset} onCancel={() => setShowResetConfirm(false)} />
    </>
  );
}

export default SettingsWidget;