import type { Task } from "../store/useAppStore";

const MAX_TITLES = 3;

/**
 * One summary for the day: open tasks due today or earlier. Null when there is
 * nothing to say. Dates are YYYY-MM-DD, so string comparison is chronological.
 */
export function buildReminderSummary(
  tasks: Pick<Task, "text" | "completed" | "deadlineDate">[],
  today: string
): { title: string; body: string } | null {
  const due = tasks
    .filter((t) => !t.completed && t.deadlineDate && t.deadlineDate <= today)
    .sort((a, b) => a.deadlineDate!.localeCompare(b.deadlineDate!));
  if (due.length === 0) return null;

  const dueToday = due.filter((t) => t.deadlineDate === today).length;
  const overdue = due.length - dueToday;
  const counts = [dueToday > 0 && `${dueToday} due today`, overdue > 0 && `${overdue} overdue`]
    .filter(Boolean)
    .join(", ");

  const shown = due.slice(0, MAX_TITLES).map((t) => t.text).join(", ");
  const more = due.length > MAX_TITLES ? ` +${due.length - MAX_TITLES} more` : "";
  return { title: "Vellum", body: `${counts}: ${shown}${more}` };
}

/**
 * Fire once per local day, at or after `reminderTime` ("HH:mm"). Because it is
 * "at or after", opening the app later in the day still triggers it.
 */
export function shouldNotifyNow(now: Date, reminderTime: string, lastNotified: string | null): boolean {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(reminderTime);
  if (!m) return false;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (lastNotified === today) return false;
  return now.getHours() * 60 + now.getMinutes() >= Number(m[1]) * 60 + Number(m[2]);
}
