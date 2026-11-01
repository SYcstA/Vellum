use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder, Wry,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

struct ToggleMenuItem(Mutex<MenuItem<Wry>>);
struct GhostMenuItem(Mutex<MenuItem<Wry>>);
struct GhostState(Mutex<bool>);
/// The currently-registered Ghost-Mode hotkey (user-customizable). The global
/// shortcut handler compares incoming presses against this so a rebind takes
/// effect without touching the handler.
struct GhostShortcut(Mutex<Option<Shortcut>>);
/// The currently-registered Quick-Capture hotkey (user-customizable), same idea
/// as GhostShortcut.
struct CaptureShortcut(Mutex<Option<Shortcut>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Default Ghost-Mode hotkey (Ctrl+Alt+G). User can rebind via set_ghost_shortcut;
    // the active combo lives in GhostShortcut state and the handler toggles
    // Ghost Mode whenever the registered combo is pressed.
    let ghost_default = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyG);
    // Default Quick-Capture hotkey (Ctrl+Alt+N); rebind via set_capture_shortcut.
    let capture_default = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyN);

    tauri::Builder::default()
        // Must be the FIRST plugin. A second launch exits immediately and hands
        // off to the running instance, which is brought to the front instead.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
                if let Some(toggle_mi) = app.try_state::<ToggleMenuItem>() {
                    if let Ok(toggle) = toggle_mi.0.lock() {
                        let _ = toggle.set_text("Hide Dashboard");
                    }
                }
            }
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let is_ghost = app
                        .try_state::<GhostShortcut>()
                        .and_then(|s| s.0.lock().ok().map(|g| g.as_ref() == Some(shortcut)))
                        .unwrap_or(false);
                    if is_ghost {
                        let current = app
                            .try_state::<GhostState>()
                            .and_then(|s| s.0.lock().ok().map(|g| *g))
                            .unwrap_or(false);
                        apply_ghost_mode(app, !current);
                        return;
                    }
                    let is_capture = app
                        .try_state::<CaptureShortcut>()
                        .and_then(|s| s.0.lock().ok().map(|g| g.as_ref() == Some(shortcut)))
                        .unwrap_or(false);
                    if is_capture {
                        // Build the window off this thread: creating a window
                        // inside the shortcut handler can deadlock on Windows.
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            show_capture_window(&app);
                        });
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        // Required for openUrl() (note links). Without it every open call fails.
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        // Persist size + position ONLY. Never restore MAXIMIZED/FULLSCREEN —
        // native maximize on a transparent+frameless window snaps back / crashes
        // on Windows. fakeMaximize() (frontend) handles fill-workArea instead.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::POSITION | StateFlags::SIZE)
                .with_denylist(&["capture"])
                .build(),
        )
        .setup(move |app| {
            let window_visible = app
                .get_webview_window("main")
                .map(|w| w.is_visible().unwrap_or(false))
                .unwrap_or(false);
            let initial_text = if window_visible {
                "Hide Dashboard"
            } else {
                "Show Dashboard"
            };

            let toggle_item: MenuItem<Wry> =
                MenuItem::with_id(app, "toggle", initial_text, true, None::<&str>)?;
            let ghost_item: MenuItem<Wry> =
                MenuItem::with_id(app, "ghost", "Enable Ghost Mode", true, None::<&str>)?;
            let quit_item: MenuItem<Wry> =
                MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle_item, &ghost_item, &quit_item])?;

            app.manage(ToggleMenuItem(Mutex::new(toggle_item.clone())));
            app.manage(GhostMenuItem(Mutex::new(ghost_item.clone())));
            app.manage(GhostState(Mutex::new(false)));
            app.manage(GhostShortcut(Mutex::new(Some(ghost_default.clone()))));
            app.manage(CaptureShortcut(Mutex::new(Some(capture_default.clone()))));

            // Clear any zombie registrations from hot-reloads, then register the
            // default Ghost-Mode hotkey. The frontend re-applies the user's saved
            // combo on boot via set_ghost_shortcut. Best-effort: if registration
            // fails (another app holds the combo), the tray item is the fallback.
            let _ = app.global_shortcut().unregister_all();
            if let Err(err) = app.global_shortcut().register(ghost_default) {
                eprintln!("Ghost-Mode hotkey registration failed: {err}");
            }
            if let Err(err) = app.global_shortcut().register(capture_default) {
                eprintln!("Quick-Capture hotkey registration failed: {err}");
            }

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Vellum");
            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }
            let _tray = tray_builder
                .on_menu_event(move |app, event| {
                    if let Some(toggle_mi) = app.try_state::<ToggleMenuItem>() {
                        if let Ok(toggle) = toggle_mi.0.lock() {
                            match event.id.as_ref() {
                                "toggle" => {
                                    if let Some(window) = app.get_webview_window("main") {
                                        // Treat a minimized window as "not shown" — on Windows a
                                        // minimized window still reports is_visible() == true, which
                                        // would otherwise make "Show" hide it (i.e. do nothing).
                                        let minimized = window.is_minimized().unwrap_or(false);
                                        let shown = window.is_visible().unwrap_or(false) && !minimized;
                                        if shown {
                                            let _ = window.hide();
                                            let _ = toggle.set_text("Show Dashboard");
                                        } else {
                                            let _ = window.unminimize();
                                            let _ = window.show();
                                            let _ = window.set_focus();
                                            let _ = toggle.set_text("Hide Dashboard");
                                        }
                                    }
                                }
                                "ghost" => {
                                    let current = app
                                        .try_state::<GhostState>()
                                        .and_then(|s| s.0.lock().ok().map(|g| *g))
                                        .unwrap_or(false);
                                    apply_ghost_mode(app, !current);
                                }
                                "quit" => {
                                    // Drop the menu-item mutex guard BEFORE the
                                    // blocking save + exit so a panic in save
                                    // can't poison the mutex.
                                    drop(toggle);
                                    let _ = app.save_window_state(
                                        StateFlags::POSITION | StateFlags::SIZE,
                                    );
                                    std::process::exit(0);
                                }
                                _ => {}
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Only the dashboard hides to tray; the capture window really closes.
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
                if let Some(toggle_mi) = window.app_handle().try_state::<ToggleMenuItem>() {
                    if let Ok(toggle) = toggle_mi.0.lock() {
                        let _ = toggle.set_text("Show Dashboard");
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            update_tray_text,
            kill_app,
            set_ghost_mode,
            set_ghost_shortcut,
            set_capture_shortcut
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn update_tray_text(app: tauri::AppHandle, text: String) {
    if let Some(toggle_mi) = app.try_state::<ToggleMenuItem>() {
        if let Ok(toggle) = toggle_mi.0.lock() {
            let _ = toggle.set_text(&text);
        }
    }
}

/// Forcefully kills the entire process. Called from frontend QuitModal.
/// Window state is already flushed JS-side via saveWindowState() before this
/// invoke, but we also flush here as defense-in-depth.
#[tauri::command]
fn kill_app(app: tauri::AppHandle) {
    let _ = app.save_window_state(StateFlags::POSITION | StateFlags::SIZE);
    std::process::exit(0);
}

/// Apply ghost (click-through) mode to the main window, keeping the tray menu
/// label, the stored state, and the frontend in sync. Routed through here from
/// BOTH the frontend toggle and the tray item so they can never disagree — and
/// so the tray always has a clickable "Disable Ghost Mode" escape hatch.
fn apply_ghost_mode(app: &tauri::AppHandle, enabled: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_ignore_cursor_events(enabled);
    }
    if let Some(state) = app.try_state::<GhostState>() {
        if let Ok(mut g) = state.0.lock() {
            *g = enabled;
        }
    }
    if let Some(mi) = app.try_state::<GhostMenuItem>() {
        if let Ok(item) = mi.0.lock() {
            let _ = item.set_text(if enabled {
                "Disable Ghost Mode"
            } else {
                "Enable Ghost Mode"
            });
        }
    }
    // Let the frontend reflect the new state (e.g. when toggled from the tray).
    let _ = app.emit("ghost-mode-changed", enabled);
}

/// Toggle click-through ("ghost") mode. Called from the frontend WindowControls.
#[tauri::command]
fn set_ghost_mode(app: tauri::AppHandle, enabled: bool) {
    apply_ghost_mode(&app, enabled);
}

/// Move a global hotkey from `slot`'s current combo to `accelerator`. Keeps the
/// old combo registered if the new one is invalid, taken by another app, or
/// already used by `other` (so a failed rebind never loses a working hotkey).
fn rebind_shortcut(
    app: &tauri::AppHandle,
    accelerator: &str,
    slot: &Mutex<Option<Shortcut>>,
    other: &Mutex<Option<Shortcut>>,
) -> Result<(), String> {
    let sc: Shortcut = accelerator
        .parse()
        .map_err(|e| format!("invalid shortcut '{accelerator}': {e:?}"))?;
    let old = slot.lock().ok().and_then(|g| g.clone());
    if old.as_ref() == Some(&sc) {
        return Ok(());
    }
    if other.lock().ok().and_then(|g| g.clone()).as_ref() == Some(&sc) {
        return Err(format!("'{accelerator}' is already used by another Vellum shortcut"));
    }
    if let Some(o) = &old {
        let _ = app.global_shortcut().unregister(o.clone());
    }
    if let Err(e) = app.global_shortcut().register(sc.clone()) {
        if let Some(o) = old {
            let _ = app.global_shortcut().register(o);
        }
        return Err(format!("'{accelerator}' is taken by another app ({e})"));
    }
    if let Ok(mut g) = slot.lock() {
        *g = Some(sc);
    }
    Ok(())
}

/// Rebind the global Ghost-Mode hotkey. `accelerator` is a Tauri accelerator
/// string (e.g. "Alt+G", "CommandOrControl+Shift+K").
#[tauri::command]
fn set_ghost_shortcut(app: tauri::AppHandle, accelerator: String) -> Result<(), String> {
    let ghost = app.state::<GhostShortcut>();
    let capture = app.state::<CaptureShortcut>();
    rebind_shortcut(&app, &accelerator, &ghost.0, &capture.0)
}

/// Rebind the global Quick-Capture hotkey.
#[tauri::command]
fn set_capture_shortcut(app: tauri::AppHandle, accelerator: String) -> Result<(), String> {
    let ghost = app.state::<GhostShortcut>();
    let capture = app.state::<CaptureShortcut>();
    rebind_shortcut(&app, &accelerator, &capture.0, &ghost.0)
}

/// Show the small always-on-top capture window, creating it on first use.
fn show_capture_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("capture") {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let built = WebviewWindowBuilder::new(app, "capture", WebviewUrl::App("index.html#capture".into()))
        .title("Quick capture")
        .inner_size(440.0, 150.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .center()
        .focused(true)
        .build();
    if let Err(err) = built {
        eprintln!("Quick-capture window failed to open: {err}");
    }
}
