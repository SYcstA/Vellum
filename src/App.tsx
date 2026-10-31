import { useEffect } from "react";
import { getCurrentWindow, currentMonitor, primaryMonitor, PhysicalSize } from "@tauri-apps/api/window";
import { saveWindowState, StateFlags } from "@tauri-apps/plugin-window-state";
import Logo from "./components/Logo";
import MasterDock from "./components/MasterDock";
import ToDoWidget from "./components/ToDoWidget";
import CalendarWidget from "./components/CalendarWidget";
import NotesWidget from "./components/NotesWidget";
import LogWidget from "./components/LogWidget";
import SettingsWidget from "./components/SettingsWidget";
import WindowControls from "./components/WindowControls";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useAppStore } from "./store/useAppStore";
import { useWindowBoundaryGuard } from "./utils/window";
import { DEFAULT_GHOST_SHORTCUT, LEGACY_GHOST_SHORTCUT } from "./utils/shortcut";
import { initSchema, markSeeded } from "./store/db";
import "./App.css";

function App() {
  useWindowBoundaryGuard();
  const isToDoOpen = useAppStore((s) => s.isToDoOpen);
  const isCalendarOpen = useAppStore((s) => s.isCalendarOpen);
  const isNotesOpen = useAppStore((s) => s.isNotesOpen);
  const isLogOpen = useAppStore((s) => s.isLogOpen);
  const isSettingsOpen = useAppStore((s) => s.isSettingsOpen);
  const loading = useAppStore((s) => s.loading);
  const loadData = useAppStore((s) => s.loadData);
  const widgetThemeColor = useAppStore((s) => s.widgetThemeColor);
  const wallpaperPath = useAppStore((s) => s.wallpaperPath);
  const setWidgetPosition = useAppStore((s) => s.setWidgetPosition);

  // Local files can't be loaded via file://; convert to Tauri's asset protocol
  // URL (requires assetProtocol enabled in tauri.conf.json).
  const wallpaperUrl = wallpaperPath ? convertFileSrc(wallpaperPath) : null;

  // Drive light-mode CSS overrides off a root attribute (pure-black uses the
  // dark token set). See the light-mode audit block in App.css.
  useEffect(() => {
    document.documentElement.dataset.theme = widgetThemeColor === "light" ? "light" : "dark";
  }, [widgetThemeColor]);

  useEffect(() => {
    async function boot() {
      try {
        await initSchema();
        await markSeeded();
        await loadData();
      } catch (err) {
        console.error("Database init failed:", err);
      }
      // Re-apply the user's saved Ghost-Mode hotkey (Rust registers the default
      // on startup; this overrides it if the user rebound the combo). The old
      // Alt+G default migrates to the new default.
      let saved = useAppStore.getState().ghostShortcut;
      if (saved === LEGACY_GHOST_SHORTCUT) {
        saved = DEFAULT_GHOST_SHORTCUT;
        useAppStore.getState().setGhostShortcut(saved);
      }
      if (saved && saved !== DEFAULT_GHOST_SHORTCUT) {
        try { await invoke("set_ghost_shortcut", { accelerator: saved }); }
        catch (err) { console.error("Re-apply ghost shortcut failed:", err); }
      }
    }
    boot();
  }, [loadData]);

  // First launch: 95% of the monitor's work area, centered. Bypasses Windows'
  // frameless-maximize snap-back bugs entirely and leaves a glass margin
  // around the edges. Subsequent launches: tauri-plugin-window-state restores
  // the persisted POSITION+SIZE, so no resizing here.
  useEffect(() => {
    const initApp = async () => {
      const appWindow = getCurrentWindow();
      const isFirstOpen = !localStorage.getItem("vellum_first_open");

      if (isFirstOpen) {
        setWidgetPosition("todo", { x: 100, y: 40, width: 420, height: 400 });
        setWidgetPosition("calendar", { x: 560, y: 40, width: 380, height: 390 });
        setWidgetPosition("notes", { x: 990, y: 40, width: 420, height: 400 });
        setWidgetPosition("log", { x: 560, y: 470, width: 380, height: 300 });
        setWidgetPosition("settings", { x: 100, y: 470, width: 320, height: 300 });

        // Fall back to primaryMonitor if currentMonitor is unknown (rare:
        // hidden window pre-show on some platforms). If both are null, skip
        // resize but still flip the flag so we don't retry forever.
        const monitor = (await currentMonitor()) ?? (await primaryMonitor());
        if (monitor) {
          const w = Math.floor(monitor.workArea.size.width * 0.95);
          const h = Math.floor(monitor.workArea.size.height * 0.95);
          await appWindow.setSize(new PhysicalSize(w, h));
          await appWindow.center();
          // tauri-plugin-window-state only auto-tracks USER drag/resize events.
          // Programmatic setSize/center never reach its listener, so the 95%
          // ratio would vanish on next launch. Flush to disk explicitly.
          try {
            await saveWindowState(StateFlags.SIZE | StateFlags.POSITION);
          } catch (err) {
            console.error("saveWindowState (first launch) failed:", err);
          }
        }
        localStorage.setItem("vellum_first_open", "false");
      } else {
        // Subsequent launches: give tauri-plugin-window-state a tick to apply
        // the restored POSITION+SIZE before show() to avoid a default-size flash.
        await new Promise((r) => setTimeout(r, 50));
      }

      await appWindow.show();
      await appWindow.setFocus();
    };
    initApp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBackgroundDrag = async (e: React.MouseEvent) => {
    // Left-button drags only, and only when the bare background is the target
    // (defensive — the layer has no children, but never hijack widget clicks).
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    try {
      await getCurrentWindow().startDragging();
    } catch (err) {
      console.error("startDragging failed:", err);
    }
  };

  return (
    <div className="w-screen h-screen relative overflow-hidden bg-transparent">
      {/* Custom wallpaper — sits BEHIND every glass surface (z-0, first in DOM).
          A baked-in dark overlay (over the image) preserves glass contrast even
          over busy photos. pointer-events-none so it never blocks interaction. */}
      {wallpaperUrl && (
        <div
          className="absolute inset-0 z-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(rgba(0,0,0,0.32), rgba(0,0,0,0.32)), url("${wallpaperUrl}")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          }}
        />
      )}

      {/* Global drag surface: the empty canvas behind every widget. Mousedown on
          bare background starts a native window drag (works across monitors).
          It sits below all widgets/dock/controls in the DOM, so hit-testing only
          reaches it on truly empty areas — never over buttons, inputs, or widgets. */}
      <div className="absolute inset-0" onMouseDown={handleBackgroundDrag} />

      {loading && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[999] bg-black/60 backdrop-blur-md px-4 py-2 rounded-xl text-white/70 text-sm">
          Loading database...
        </div>
      )}

      {isToDoOpen && <ToDoWidget />}
      {isCalendarOpen && <CalendarWidget />}
      {isNotesOpen && <NotesWidget />}
      {isLogOpen && <LogWidget />}
      {isSettingsOpen && <SettingsWidget />}

      {/* Vellum brand mark — fixed top-center, decorative. pointer-events-none
          so it never blocks the background drag region underneath. */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 pointer-events-none select-none">
        <Logo size={56} />
      </div>

      <WindowControls />
      <div className="z-50">
        <MasterDock />
      </div>
    </div>
  );
}

export default App;