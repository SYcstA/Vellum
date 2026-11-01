import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { useAppStore } from "../store/useAppStore";
import { localDateStr } from "./date";
import { decideReminder } from "./reminders";

const LAST_KEY = "vellum_last_reminder";
const STATUS_KEY = "vellum_reminder_status";

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

/** Last outcome, shown in Settings so a silent skip can be explained. */
function record(msg: string): void {
  try {
    const d = new Date();
    const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    localStorage.setItem(STATUS_KEY, `${hhmm} · ${msg}`);
  } catch { /* status is best-effort */ }
}

async function doCheck(time: string): Promise<void> {
  let last: string | null = null;
  try { last = localStorage.getItem(LAST_KEY); } catch { /* treat as never notified */ }
  const { tasks, reminderLeadDays } = useAppStore.getState();
  const decision = decideReminder(new Date(), time, last, tasks, reminderLeadDays);
  if (!decision.send) { record(`skipped: ${decision.reason}`); return; }
  try {
    // Same rule as the Settings "Send test" button: ask if not already allowed.
    // (Bailing out silently on a "no" is how reminders went missing while the test worked.)
    if (!(await isPermissionGranted())) {
      const answer = await requestPermission();
      if (answer !== "granted") record(`permission answer was "${answer}"; sending anyway`);
    }
    sendNotification(decision.summary);
    localStorage.setItem(LAST_KEY, localDateStr());
    record(`sent: ${decision.summary.body}`);
  } catch (err) {
    record(`error: ${String(err)}`);
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
