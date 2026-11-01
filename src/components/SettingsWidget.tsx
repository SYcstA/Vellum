import { useState, useEffect } from "react";
import { Rnd } from "react-rnd";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { useAppStore } from "../store/useAppStore";
import { glassStyle } from "../utils/glass";
import { clampWidgetPosition, useWidgetBoundaryClamp } from "../utils/window";
import { X, Check, Trash2 } from "lucide-react";
import ConfirmModal from "./ConfirmModal";
import { exportBackup, pickBackup, applyBackup } from "../store/backupIO";
import type { BackupV1 } from "../store/backup";
import { acceleratorFromEvent, describeShortcut, DEFAULT_GHOST_SHORTCUT, DEFAULT_NOTE_NEW_KEY, DEFAULT_NOTE_SEARCH_KEY } from "../utils/shortcut";

/**
 * One row of the Shortcuts list: label + where it works, a click-to-rebind key
 * box and Reset. `apply` saves the new combo and
 * throws if it can't (taken by another app, duplicate, ...); the old one then
 * stays in force.
 */
function ShortcutRow({ label, hint, value, defaultValue, apply, isLight }: {
  label: string; hint: string; value: string; defaultValue: string;
  apply: (acc: string) => Promise<void>; isLight: boolean;
}) {
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");

  const save = async (acc: string) => {
    try {
      await apply(acc);
      setError("");
      setCapturing(false);
      setPreview("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Esc cancels; otherwise build the accelerator from the pressed combo and show
  // the held modifiers live so the user sees what is being captured.
  const capture = async (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation(); // keep the window-level app hotkeys from also firing
    if (e.key === "Escape") { setCapturing(false); setPreview(""); setError(""); return; }
    const r = acceleratorFromEvent(e.nativeEvent);
    setPreview(r.preview);
    if (r.error) { setError(r.error); return; }
    if (r.acc) await save(r.acc);
  };

  const sub = isLight ? "text-gray-400" : "text-white/30";
  const small = `text-[10px] font-medium transition-colors px-2 py-1.5 rounded-lg border ${isLight ? "bg-gray-100 text-gray-500 border-gray-300 hover:text-gray-800" : "bg-white/5 text-white/50 border-white/10 hover:text-white/90 hover:border-white/30"}`;
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <div className="flex-1 min-w-0">
          <p className={`text-xs ${isLight ? "text-gray-700" : "text-white/80"}`}>{label}</p>
          <p className={`text-[10px] ${sub}`}>{hint}</p>
        </div>
        <button
          onKeyDown={capturing ? capture : undefined}
          onClick={() => { setCapturing(true); setError(""); setPreview(""); }}
          onBlur={() => { setCapturing(false); setPreview(""); }}
          title="Click, then press the new combo (Esc to cancel)"
          className={`min-w-24 text-xs font-medium transition-colors px-2 py-1.5 rounded-lg border ${capturing ? "bg-indigo-500/30 text-indigo-200 border-indigo-400/60" : `${isLight ? "bg-gray-100 text-gray-700 border-gray-300 hover:border-gray-400" : "bg-white/5 text-white/70 border-white/10 hover:border-white/30"}`}`}
        >
          <span className="font-mono">{capturing ? (preview || "Press keys…") : describeShortcut(value)}</span>
        </button>
        {!capturing && value !== defaultValue && (
          <button onClick={() => save(defaultValue)} title={`Reset to ${describeShortcut(defaultValue)}`} className={small}>Reset</button>
        )}
      </div>
      {error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}
    </div>
  );
}

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
  const noteNewKey = useAppStore((s) => s.noteNewKey);
  const setNoteNewKey = useAppStore((s) => s.setNoteNewKey);
  const noteSearchKey = useAppStore((s) => s.noteSearchKey);
  const setNoteSearchKey = useAppStore((s) => s.setNoteSearchKey);

  const applyGhost = async (acc: string) => {
    await invoke("set_ghost_shortcut", { accelerator: acc });
    setGhostShortcut(acc);
  };
  // In-app (Notes) keys are matched by Vellum itself, so no OS registration:
  // just refuse the Win key (not seen by the matcher) and clashes with the sibling key.
  const applyNoteKey = async (acc: string, other: string, save: (a: string) => void, otherLabel: string) => {
    if (acc.includes("Super")) throw new Error("The Win key can't be used for in-app shortcuts.");
    if (acc === other) throw new Error(`Already used by "${otherLabel}".`);
    save(acc);
  };
  useWidgetBoundaryClamp("settings", widgetPos, setWidgetPos);

  const remindersEnabled = useAppStore((s) => s.remindersEnabled);
  const setRemindersEnabled = useAppStore((s) => s.setRemindersEnabled);
  const reminderTime = useAppStore((s) => s.reminderTime);
  const setReminderTime = useAppStore((s) => s.setReminderTime);
  const [reminderError, setReminderError] = useState("");
  const loadData = useAppStore((s) => s.loadData);
  const refreshLogs = useAppStore((s) => s.refreshLogs);
  const [pendingImport, setPendingImport] = useState<BackupV1 | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
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

  const handleToggleReminders = async () => {
    if (remindersEnabled) { setRemindersEnabled(false); return; }
    try {
      const ok = (await isPermissionGranted()) || (await requestPermission()) === "granted";
      if (!ok) { setReminderError("Notifications are blocked. Allow them for Vellum in Windows Settings."); return; }
      setReminderError("");
      setRemindersEnabled(true);
    } catch (err) {
      setReminderError(String(err));
    }
  };

  const handleExport = async () => {
    setBackupBusy(true);
    try {
      const path = await exportBackup();
      if (path) setBackupMsg({ ok: true, text: `Exported to ${path}` });
    } catch (err) {
      setBackupMsg({ ok: false, text: `Export failed: ${String(err)}` });
    } finally {
      setBackupBusy(false);
    }
  };

  // Parse + validate first; nothing is touched until the user confirms.
  const handlePickImport = async () => {
    setBackupBusy(true);
    try {
      const picked = await pickBackup();
      if (picked) { setPendingImport(picked.backup); setBackupMsg(null); }
    } catch (err) {
      setBackupMsg({ ok: false, text: String(err instanceof Error ? err.message : err) });
    } finally {
      setBackupBusy(false);
    }
  };

  const handleConfirmImport = async () => {
    const backup = pendingImport;
    setPendingImport(null);
    if (!backup) return;
    setBackupBusy(true);
    try {
      const safetyPath = await applyBackup(backup);
      await loadData();
      await refreshLogs();
      // IDs changed: drop selections/filters that may point at rows that no longer exist.
      useAppStore.setState({ highlightedNoteId: null, activeCategoryFilter: "", activeDateFilter: "" });
      setBackupMsg({ ok: true, text: `Imported. Previous data saved to ${safetyPath}` });
    } catch (err) {
      setBackupMsg({ ok: false, text: `Import failed: ${String(err)}. Data may be incomplete; restore from the backups folder in the app data directory.` });
      try { await loadData(); } catch { /* already reported above */ }
    } finally {
      setBackupBusy(false);
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
            {/* Shortcuts */}
            <div>
              <p className={`text-xs ${textSecondary} mb-2`}>Shortcuts</p>
              <div className="space-y-2.5">
                <ShortcutRow label="Ghost Mode" hint="Anywhere · click-through on/off" value={ghostShortcut} defaultValue={DEFAULT_GHOST_SHORTCUT} apply={applyGhost} isLight={isLight} />
                <ShortcutRow label="New note" hint="Notes · inside Vellum" value={noteNewKey} defaultValue={DEFAULT_NOTE_NEW_KEY} apply={(acc) => applyNoteKey(acc, noteSearchKey, setNoteNewKey, "Search notes")} isLight={isLight} />
                <ShortcutRow label="Search notes" hint="Notes · inside Vellum" value={noteSearchKey} defaultValue={DEFAULT_NOTE_SEARCH_KEY} apply={(acc) => applyNoteKey(acc, noteNewKey, setNoteSearchKey, "New note")} isLight={isLight} />
              </div>
              <p className={`text-[10px] mt-1 ${isLight ? "text-gray-400" : "text-white/30"}`}>Click a key box, then press the new combo. Esc cancels.</p>
            </div>
            {/* Deadline reminders */}
            <div>
              <p className={`text-xs ${textSecondary} mb-2`}>Deadline Reminder</p>
              <div className="flex gap-1.5">
                <button onClick={handleToggleReminders} className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-medium transition-colors px-3 py-2 rounded-lg border ${remindersEnabled ? "text-emerald-300 bg-emerald-500/20 border-emerald-500/30" : `${isLight ? "bg-gray-100 text-gray-600 border-gray-300" : "bg-white/5 text-white/60 border-white/10 hover:border-white/30"}`}`}>
                  {remindersEnabled && <Check size={13} strokeWidth={2.5} />}Daily summary
                </button>
                <input type="time" value={reminderTime} disabled={!remindersEnabled}
                  onChange={(e) => e.target.value && setReminderTime(e.target.value)}
                  className={`text-xs font-mono px-2 py-2 rounded-lg border outline-none disabled:opacity-40 ${isLight ? "bg-gray-100 text-gray-700 border-gray-300" : "bg-white/5 text-white/70 border-white/10"}`} title="Reminder time" />
              </div>
              <p className={`text-[10px] mt-1 ${isLight ? "text-gray-400" : "text-white/30"}`}>One toast a day for tasks due or past due, while Vellum is running.</p>
              {reminderError && <p className="text-[10px] text-red-400 mt-1">{reminderError}</p>}
            </div>
            {/* Backup */}
            <div>
              <p className={`text-xs ${textSecondary} mb-2`}>Backup</p>
              <div className="flex gap-1.5">
                {([["Export…", handleExport], ["Import…", handlePickImport]] as const).map(([label, fn]) => (
                  <button key={label} onClick={fn} disabled={backupBusy}
                    className={`flex-1 text-xs font-medium transition-colors px-3 py-2 rounded-lg border disabled:opacity-50 ${isLight ? "bg-gray-100 text-gray-700 border-gray-300 hover:border-gray-400" : "bg-white/5 text-white/70 border-white/10 hover:border-white/30"}`}>
                    {label}
                  </button>
                ))}
              </div>
              {backupMsg && (
                <p className={`text-[10px] mt-1 break-all ${backupMsg.ok ? (isLight ? "text-gray-500" : "text-white/50") : "text-red-400"}`}>{backupMsg.text}</p>
              )}
            </div>
            {/* Danger Zone */}
            <div>
              <p className={`text-xs ${textSecondary} mb-2`}>Danger Zone</p>
              <button onClick={() => setShowResetConfirm(true)} className="w-full flex items-center justify-center gap-1.5 text-xs font-medium text-red-300 bg-red-500/20 hover:bg-red-500/30 transition-colors px-3 py-2 rounded-lg border border-red-500/30"><Trash2 size={13} strokeWidth={1.75} /> Factory Reset — Delete All Data</button>
            </div>
          </div>
        </div>
      </Rnd>
      <ConfirmModal
        open={pendingImport !== null}
        title="Import backup"
        message={pendingImport
          ? `This replaces ALL current data with the file's ${pendingImport.tasks.length} tasks, ${pendingImport.notes.length} notes, ${pendingImport.categories.length} tags, ${pendingImport.logs.length} log entries (exported ${pendingImport.exportedAt.slice(0, 10)}). Your current data is saved to a safety copy first.`
          : ""}
        confirmLabel="Replace data"
        confirmTone="primary"
        onConfirm={handleConfirmImport}
        onCancel={() => setPendingImport(null)}
      />
      <ConfirmModal open={showResetConfirm} title="Factory Reset" message="Are you sure you want to delete ALL data? This action cannot be undone." confirmLabel="Delete Everything" onConfirm={handleFactoryReset} onCancel={() => setShowResetConfirm(false)} />
    </>
  );
}

export default SettingsWidget;