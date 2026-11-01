import { useEffect } from "react";
import { isPermissionGranted, sendNotification } from "@tauri-apps/plugin-notification";
import { useAppStore } from "../store/useAppStore";
import { localDateStr } from "./date";
import { buildReminderSummary, shouldNotifyNow } from "./reminders";

const LAST_KEY = "vellum_last_reminder";

/**
 * Daily deadline toast: at the reminder time, or on app open if that time has
 * passed and nothing was sent today. Checks on load and every 60 s. Only runs
 * while the app does (the tray keeps it alive).
 */
export function useDeadlineReminders(): void {
  const enabled = useAppStore((s) => s.remindersEnabled);
  const time = useAppStore((s) => s.reminderTime);
  const loaded = useAppStore((s) => s.loaded);

  useEffect(() => {
    if (!enabled || !loaded) return;
    let cancelled = false;

    const check = async () => {
      let last: string | null = null;
      try { last = localStorage.getItem(LAST_KEY); } catch { /* treat as never notified */ }
      if (!shouldNotifyNow(new Date(), time, last)) return;
      const summary = buildReminderSummary(useAppStore.getState().tasks, localDateStr());
      if (!summary) return;
      try {
        if (!(await isPermissionGranted()) || cancelled) return;
        sendNotification(summary);
        localStorage.setItem(LAST_KEY, localDateStr());
      } catch (err) {
        console.error("Deadline reminder failed:", err);
      }
    };

    check();
    const id = setInterval(check, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled, time, loaded]);
}
