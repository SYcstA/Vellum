use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, Wry,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

struct ToggleMenuItem(Mutex<MenuItem<Wry>>);
struct GhostMenuItem(Mutex<MenuItem<Wry>>);
struct GhostState(Mutex<bool>);
/// True when this process was started by the Windows scheduled task (`--reminder`):
/// it should stay hidden, show the deadline toast and exit.
struct ReminderLaunch(bool);
/// Set when the user opens Vellum normally while a hidden `--reminder` process is
/// still alive (it holds the single-instance lock, so the launch is forwarded to
/// it and its window is shown). The pending auto-exit must then be skipped.
struct ReminderExitCancelled(AtomicBool);
/// The currently-registered Ghost-Mode hotkey (user-customizable). The global
/// shortcut handler compares incoming presses against this so a rebind takes
/// effect without touching the handler.
struct GhostShortcut(Mutex<Option<Shortcut>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Default Ghost-Mode hotkey (Ctrl+Alt+G). User can rebind via set_ghost_shortcut;
    // the active combo lives in GhostShortcut state and the handler toggles
    // Ghost Mode whenever the registered combo is pressed.
    let ghost_default = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyG);

    let builder = tauri::Builder::default();
    // Must be the FIRST plugin. A second launch exits immediately and hands
    // off to the running instance, which is brought to the front instead.
    // Release builds only: a dev build shares the installed app's identifier,
    // so with this plugin `tauri dev` would just focus the installed app.
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        // The scheduled reminder fired while Vellum is already running: just
        // ask the dashboard to run its reminder check; don't steal focus.
        if args.iter().any(|a| a == "--reminder") {
            let _ = app.emit("reminder-check", ());
            return;
        }
        // A normal launch was forwarded here: the user wants this window, so a
        // reminder-only process must not quit it a moment later.
        if let Some(state) = app.try_state::<ReminderExitCancelled>() {
            state.0.store(true, Ordering::SeqCst);
        }
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
    }));

    builder
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
            app.manage(ReminderLaunch(std::env::args().any(|a| a == "--reminder")));
            app.manage(ReminderExitCancelled(AtomicBool::new(false)));
            app.manage(GhostShortcut(Mutex::new(Some(ghost_default))));

            // Clear any zombie registrations from hot-reloads, then register the
            // default Ghost-Mode hotkey. The frontend re-applies the user's saved
            // combo on boot via set_ghost_shortcut. Best-effort: if registration
            // fails (another app holds the combo), the tray item is the fallback.
            let _ = app.global_shortcut().unregister_all();
            if let Err(err) = app.global_shortcut().register(ghost_default) {
                eprintln!("Ghost-Mode hotkey registration failed: {err}");
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
            reminder_exit,
            set_ghost_mode,
            set_ghost_shortcut,
            launched_for_reminder,
            set_reminder_task
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

/// End of a `--reminder` run (toast handed to Windows). Quits like `kill_app`,
/// unless the user opened Vellum meanwhile (see `ReminderExitCancelled`).
#[tauri::command]
fn reminder_exit(app: tauri::AppHandle) {
    let cancelled = app
        .try_state::<ReminderExitCancelled>()
        .map(|s| s.0.load(Ordering::SeqCst))
        .unwrap_or(false);
    if !cancelled {
        kill_app(app);
    }
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

/// Rebind the global Ghost-Mode hotkey. `accelerator` is a Tauri accelerator
/// string (e.g. "Alt+G", "CommandOrControl+Shift+K"). Unregisters the old combo,
/// registers the new one, and stores it so the handler recognizes it.
#[tauri::command]
fn set_ghost_shortcut(app: tauri::AppHandle, accelerator: String) -> Result<(), String> {
    let sc: Shortcut = accelerator
        .parse()
        .map_err(|e| format!("invalid shortcut '{accelerator}': {e:?}"))?;
    let old = app
        .try_state::<GhostShortcut>()
        .and_then(|s| s.0.lock().ok().and_then(|g| *g));
    // Only skip when the combo is really registered: if startup registration
    // failed (another app held it) the stored value is stale and must be retried.
    if old.as_ref() == Some(&sc) && app.global_shortcut().is_registered(sc) {
        return Ok(());
    }
    if let Some(o) = &old {
        let _ = app.global_shortcut().unregister(*o);
    }
    if let Err(e) = app.global_shortcut().register(sc) {
        // Keep the previous hotkey alive so a failed rebind never leaves the
        // user without a way to leave Ghost Mode.
        if let Some(o) = old {
            let _ = app.global_shortcut().register(o);
        }
        return Err(format!("'{accelerator}' is taken by another app ({e})"));
    }
    if let Some(state) = app.try_state::<GhostShortcut>() {
        if let Ok(mut g) = state.0.lock() {
            *g = Some(sc);
        }
    }
    Ok(())
}

/// Did the Windows scheduled task start this process (so it should stay hidden)?
#[tauri::command]
fn launched_for_reminder(app: tauri::AppHandle) -> bool {
    app.try_state::<ReminderLaunch>().map(|r| r.0).unwrap_or(false)
}

const REMINDER_TASK: &str = "Vellum Daily Reminder";

/// "HH:mm" with a valid 24-hour clock value; guards everything written into the task XML.
fn valid_hhmm(t: &str) -> bool {
    let b = t.as_bytes();
    t.is_ascii()
        && b.len() == 5
        && b[2] == b':'
        && t[..2].parse::<u8>().is_ok_and(|h| h < 24)
        && t[3..].parse::<u8>().is_ok_and(|m| m < 60)
}

/// Create/replace (enabled) or delete (disabled) a per-user Windows scheduled
/// task that starts Vellum with `--reminder` every day at `time`, so the toast
/// appears even after the app was quit. Runs on battery and catches up if the PC
/// was off at that time. Installed (release) builds only: a dev exe path would
/// be wrong.
#[tauri::command]
fn set_reminder_task(enabled: bool, time: String) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("Only available in the installed app.".into());
    }
    #[cfg(not(windows))]
    {
        let _ = (enabled, time);
        return Err("Only available on Windows.".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let run = |args: &[&str]| {
            std::process::Command::new("schtasks")
                .args(args)
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| format!("could not run schtasks: {e}"))
        };

        if !enabled {
            // Deleting a task that does not exist is fine.
            let _ = run(&["/Delete", "/TN", REMINDER_TASK, "/F"])?;
            return Ok(());
        }
        if !valid_hhmm(&time) {
            return Err(format!("invalid time '{time}'"));
        }
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe = exe
            .to_string_lossy()
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;");
        let xml = format!(
            r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers><CalendarTrigger><StartBoundary>2026-01-01T{time}:00</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger></Triggers>
  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT5M</ExecutionTimeLimit></Settings>
  <Actions Context="Author"><Exec><Command>{exe}</Command><Arguments>--reminder</Arguments></Exec></Actions>
</Task>"#
        );
        // schtasks wants UTF-16 LE with a BOM.
        let mut bytes: Vec<u8> = vec![0xFF, 0xFE];
        for u in xml.encode_utf16() {
            bytes.extend_from_slice(&u.to_le_bytes());
        }
        let path = std::env::temp_dir().join("vellum-reminder-task.xml");
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
        let path_s = path.to_string_lossy().to_string();
        let out = run(&["/Create", "/TN", REMINDER_TASK, "/XML", &path_s, "/F"]);
        let _ = std::fs::remove_file(&path);
        let out = out?;
        if out.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    }
}
