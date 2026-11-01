import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isPermissionGranted, sendNotification } from "@tauri-apps/plugin-notification";
import { useAppStore } from "../store/useAppStore";
import { localDateStr } from "./date";
import { buildReminderSummary, shouldNotifyNow } from "./reminders";

const LAST_KEY = "vellum_last_reminder";

let inFlight: Promise<void> | null = null;

/**
 * Send today's summary if the time has passed and none was sent today. Callers
 * can overlap (interval, scheduled-launch path, "reminder-check" event), so
 * concurrent calls share one run: no double toast.
 */
function checkAndNotify(time: string): Promise<void> {
  if (!inFlight) inFlight = doCheck(time).finally(() => { inFlight = null; });
  return inFlight;
}

async function doCheck(time: string): Promise<void> {
  let last: string | null = null;
  try { last = localStorage.getItem(LAST_KEY); } catch { /* treat as never notified */ }
  if (!shouldNotifyNow(new Date(), time, last)) return;
  const { tasks, reminderLeadDays } = useAppStore.getState();
  const summary = buildReminderSummary(tasks, localDateStr(), reminderLeadDays);
  if (!summary) return;
  try {
    if (!(await isPermissionGranted())) return;
    sendNotification(summary);
    localStorage.setItem(LAST_KEY, localDateStr());
  } catch (err) {
    console.error("Deadline reminder failed:", err);
  }
}

/**
 * Daily deadline toast: at the reminder time, or on app open if that time has
 * passed and nothing was sent today. Checks on load and every 60 s while the
 * app runs. With "remind when closed" a Windows scheduled task also starts
 * Vellum hidden (`--reminder`) at that time: it shows the toast and exits.
 */
export function useDeadlineReminders(): void {
  const enabled = useAppStore((s) => s.remindersEnabled);
  const time = useAppStore((s) => s.reminderTime);
  const whenClosed = useAppStore((s) => s.reminderWhenClosed);
  const loaded = useAppStore((s) => s.loaded);

  useEffect(() => {
    if (!enabled || !loaded) return;
    let cancelled = false;
    const run = () => { if (!cancelled) void checkAndNotify(time); };
    run();
    const id = setInterval(run, 60_000);
    // The scheduled task fired while the app is already running.
    const unlisten = listen("reminder-check", run);
    return () => { cancelled = true; clearInterval(id); void unlisten.then((un) => un()); };
  }, [enabled, time, loaded]);

  // Keep the scheduled task in step with the settings (also heals a moved install).
  // Errors are expected in dev builds, so they are only logged.
  useEffect(() => {
    if (!whenClosed) return; // toggling it off already deleted the task
    invoke("set_reminder_task", { enabled: enabled && whenClosed, time })
      .catch((err) => console.debug("Reminder task not updated:", err));
  }, [enabled, whenClosed, time]);

  // Started by the scheduled task: once the data is loaded and the check has run,
  // give the toast a moment to be handed to Windows, then quit.
  useEffect(() => {
    if (!loaded) return;
    let stopped = false;
    invoke<boolean>("launched_for_reminder").then(async (hidden) => {
      if (!hidden || stopped) return;
      const { remindersEnabled, reminderTime } = useAppStore.getState();
      if (remindersEnabled) await checkAndNotify(reminderTime);
      setTimeout(() => { void invoke("kill_app"); }, 4000);
    }).catch(() => { /* not in Tauri */ });
    return () => { stopped = true; };
  }, [loaded]);
}
