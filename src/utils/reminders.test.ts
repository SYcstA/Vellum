import { describe, expect, it } from "vitest";
import { buildReminderSummary, shouldNotifyNow } from "./reminders";

const TODAY = "2026-11-01";
const t = (text: string, deadlineDate?: string, completed = false) => ({
  id: text, text, tags: [], completed, deadlineDate,
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
