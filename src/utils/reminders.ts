import type { Task } from "../store/useAppStore";
import { addDays } from "./date";

const MAX_TITLES = 3;

type Remindable = Pick<Task, "text" | "completed" | "deadlineDate" | "reminderDate">;

/** Local "YYYY-MM-DD" of a Date. */
function dayOf(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * One summary for the day. An open task is included when it is overdue, due
 * today, due within the next `leadDays` days ("due soon"), or has its own
 * reminder date set to today. Null when there is nothing to say. Dates are
 * YYYY-MM-DD, so string comparison is chronological.
 */
export function buildReminderSummary(
  tasks: Remindable[],
  today: string,
  leadDays = 0
): { title: string; body: string } | null {
  const horizon = addDays(today, Math.max(0, leadDays));
  const counts = { overdue: 0, today: 0, soon: 0, reminder: 0 };
  const picked: { text: string; key: string }[] = [];

  for (const t of tasks) {
    if (t.completed) continue;
    const d = t.deadlineDate;
    if (d && d < today) counts.overdue++;
    else if (d === today) counts.today++;
    else if (d && d <= horizon) counts.soon++;
    else if (t.reminderDate === today) counts.reminder++;
    else continue;
    // Oldest first; a plain reminder sorts as "today".
    picked.push({ text: t.text, key: d && d <= horizon ? d : today });
  }
  if (picked.length === 0) return null;

  picked.sort((a, b) => a.key.localeCompare(b.key));
  const parts = [
    counts.overdue > 0 && `${counts.overdue} overdue`,
    counts.today > 0 && `${counts.today} due today`,
    counts.soon > 0 && `${counts.soon} due soon`,
    counts.reminder > 0 && `${counts.reminder} reminder`,
  ].filter(Boolean).join(", ");
  const shown = picked.slice(0, MAX_TITLES).map((p) => p.text).join(", ");
  const more = picked.length > MAX_TITLES ? ` +${picked.length - MAX_TITLES} more` : "";
  return { title: "Vellum", body: `${parts}: ${shown}${more}` };
}

/**
 * Fire once per local day, at or after `reminderTime` ("HH:mm"). Because it is
 * "at or after", opening the app later in the day still triggers it.
 */
export function shouldNotifyNow(now: Date, reminderTime: string, lastNotified: string | null): boolean {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(reminderTime);
  if (!m) return false;
  if (lastNotified === dayOf(now)) return false;
  return now.getHours() * 60 + now.getMinutes() >= Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Check a per-task reminder date. A day that has passed is refused, and so is
 * today once the daily reminder time has gone by (it would never fire).
 * Returns an error message, or null when fine (including "no reminder").
 */
export function validateReminderDate(date: string, now: Date, reminderTime: string): string | null {
  if (!date) return null;
  const today = dayOf(now);
  if (date < today) return "That day has already passed.";
  if (date === today && shouldNotifyNow(now, reminderTime, null)) {
    return `Today's reminder time (${reminderTime}) has already passed.`;
  }
  return null;
}
