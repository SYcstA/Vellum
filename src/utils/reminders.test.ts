import { describe, expect, it } from "vitest";
import { buildReminderSummary, shouldNotifyNow, validateReminderDate } from "./reminders";

const TODAY = "2026-11-01";
const t = (text: string, deadlineDate?: string, completed = false, reminderDate?: string) => ({
  id: text, text, tags: [], completed, deadlineDate, reminderDate,
});

describe("buildReminderSummary", () => {
  it("returns null when nothing is due or overdue", () => {
    expect(buildReminderSummary([t("later", "2026-11-09"), t("no deadline")], TODAY)).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(buildReminderSummary([], TODAY)).toBeNull();
  });

  it("ignores completed tasks", () => {
    expect(buildReminderSummary([t("done", "2026-10-01", true), t("done too", TODAY, true)], TODAY)).toBeNull();
  });

  it("counts due-today and overdue separately in the body", () => {
    const s = buildReminderSummary([t("a", TODAY), t("b", "2026-10-30"), t("c", "2026-10-29")], TODAY)!;
    expect(s.body).toContain("1 due today");
    expect(s.body).toContain("2 overdue");
  });

  it("omits a group that is empty", () => {
    const s = buildReminderSummary([t("a", TODAY)], TODAY)!;
    expect(s.body).toContain("1 due today");
    expect(s.body).not.toContain("overdue");
  });

  it("lists the first 3 titles and '+N more' for the rest", () => {
    const tasks = ["alpha", "bravo", "charlie", "delta", "echo"].map((x) => t(x, TODAY));
    const s = buildReminderSummary(tasks, TODAY)!;
    expect(s.body).toContain("alpha");
    expect(s.body).toContain("charlie");
    expect(s.body).not.toContain("delta");
    expect(s.body).toContain("+2 more");
  });

  it("lists the oldest deadlines first", () => {
    const s = buildReminderSummary([t("newer-task", TODAY), t("oldest-task", "2026-10-01")], TODAY)!;
    expect(s.body.indexOf("oldest-task")).toBeLessThan(s.body.indexOf("newer-task"));
  });

  it("has a non-empty title", () => {
    expect(buildReminderSummary([t("a", TODAY)], TODAY)!.title.length).toBeGreaterThan(0);
  });
});

describe("shouldNotifyNow", () => {
  const at = (h: number, m: number) => new Date(2026, 10, 1, h, m, 0);

  it("is false before the reminder time", () => {
    expect(shouldNotifyNow(at(8, 59), "09:00", null)).toBe(false);
  });

  it("is true at the reminder time when not yet notified today", () => {
    expect(shouldNotifyNow(at(9, 0), "09:00", "2026-10-31")).toBe(true);
  });

  it("is false when already notified today", () => {
    expect(shouldNotifyNow(at(12, 0), "09:00", "2026-11-01")).toBe(false);
  });

  it("is true when the app opens well after the time and nothing was sent today", () => {
    expect(shouldNotifyNow(at(14, 0), "09:00", null)).toBe(true);
  });

  it("is false for a malformed reminder time", () => {
    expect(shouldNotifyNow(at(14, 0), "", null)).toBe(false);
    expect(shouldNotifyNow(at(14, 0), "25:99", null)).toBe(false);
  });
});

describe("buildReminderSummary with a look-ahead window", () => {
  it("ignores tasks due tomorrow by default (0 days)", () => {
    expect(buildReminderSummary([t("later", "2026-11-02")], TODAY)).toBeNull();
  });

  it("includes tasks due tomorrow with a 1-day window, as 'due soon'", () => {
    const s = buildReminderSummary([t("tmrw-task", "2026-11-02")], TODAY, 1)!;
    expect(s.body).toContain("1 due soon");
    expect(s.body).toContain("tmrw-task");
  });

  it("includes the last day of the window and excludes the day after", () => {
    expect(buildReminderSummary([t("edge", "2026-11-04")], TODAY, 3)).not.toBeNull();
    expect(buildReminderSummary([t("past-edge", "2026-11-05")], TODAY, 3)).toBeNull();
  });

  it("counts all groups together", () => {
    const s = buildReminderSummary(
      [t("a", "2026-10-30"), t("b", TODAY), t("c", "2026-11-03")],
      TODAY,
      2
    )!;
    expect(s.body).toContain("1 overdue");
    expect(s.body).toContain("1 due today");
    expect(s.body).toContain("1 due soon");
  });
});

describe("buildReminderSummary with a per-task reminder date", () => {
  it("includes an open task whose reminder date is today, even with no deadline", () => {
    const s = buildReminderSummary([t("remind-me", undefined, false, TODAY)], TODAY)!;
    expect(s.body).toContain("1 reminder");
    expect(s.body).toContain("remind-me");
  });

  it("includes it even when the deadline is far away", () => {
    const s = buildReminderSummary([t("far", "2026-12-31", false, TODAY)], TODAY)!;
    expect(s.body).toContain("1 reminder");
  });

  it("ignores a reminder date in the future or the past", () => {
    expect(buildReminderSummary([t("x", undefined, false, "2026-11-02")], TODAY)).toBeNull();
    expect(buildReminderSummary([t("y", undefined, false, "2026-10-31")], TODAY)).toBeNull();
  });

  it("does not count a task twice when its deadline already puts it in the summary", () => {
    const s = buildReminderSummary([t("both", TODAY, false, TODAY)], TODAY)!;
    expect(s.body).toContain("1 due today");
    expect(s.body).not.toContain("reminder");
  });

  it("ignores completed tasks", () => {
    expect(buildReminderSummary([t("done", undefined, true, TODAY)], TODAY)).toBeNull();
  });
});

describe("validateReminderDate", () => {
  const at = (h: number, m: number) => new Date(2026, 10, 1, h, m, 0);

  it("allows no reminder", () => {
    expect(validateReminderDate("", at(10, 0), "09:00")).toBeNull();
  });

  it("allows a future day", () => {
    expect(validateReminderDate("2026-11-02", at(23, 59), "09:00")).toBeNull();
  });

  it("rejects a day that has passed", () => {
    expect(validateReminderDate("2026-10-31", at(10, 0), "09:00")).toMatch(/passed/i);
  });

  it("allows today while the daily reminder time is still ahead", () => {
    expect(validateReminderDate("2026-11-01", at(8, 59), "09:00")).toBeNull();
  });

  it("rejects today once the daily reminder time has passed", () => {
    expect(validateReminderDate("2026-11-01", at(9, 0), "09:00")).toMatch(/09:00/);
    expect(validateReminderDate("2026-11-01", at(18, 30), "09:00")).toMatch(/passed/i);
  });
});
