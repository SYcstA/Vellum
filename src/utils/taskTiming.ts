export type TaskTiming = "pending" | "due-today" | "overdue" | "done-on-time" | "done-late";

/**
 * Where a task stands against its deadline. Dates are zero-padded
 * YYYY-MM-DD, so plain string comparison orders them correctly.
 */
export function taskTiming(
  t: { completed: boolean; deadlineDate?: string; completionDate?: string },
  today: string
): TaskTiming {
  if (t.completed) {
    return t.deadlineDate && t.completionDate && t.completionDate > t.deadlineDate
      ? "done-late"
      : "done-on-time";
  }
  if (!t.deadlineDate) return "pending";
  if (t.deadlineDate < today) return "overdue";
  if (t.deadlineDate === today) return "due-today";
  return "pending";
}

/** Days (YYYY-MM-DD) on which at least one task was finished after its deadline. */
export function lateCompletionDates(
  tasks: { completed: boolean; deadlineDate?: string; completionDate?: string }[],
  today: string
): Set<string> {
  const days = new Set<string>();
  for (const t of tasks) {
    if (t.completionDate && taskTiming(t, today) === "done-late") days.add(t.completionDate);
  }
  return days;
}
