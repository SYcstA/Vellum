import { describe, expect, it } from "vitest";
import { lateCompletionDates, taskTiming } from "./taskTiming";

const TODAY = "2026-11-01";

describe("taskTiming (open tasks)", () => {
  it("is pending with no deadline", () => {
    expect(taskTiming({ completed: false }, TODAY)).toBe("pending");
  });

  it("is pending when the deadline is in the future", () => {
    expect(taskTiming({ completed: false, deadlineDate: "2026-11-02" }, TODAY)).toBe("pending");
  });

  it("is due-today when the deadline is today", () => {
    expect(taskTiming({ completed: false, deadlineDate: TODAY }, TODAY)).toBe("due-today");
  });

  it("is overdue when the deadline was before today", () => {
    expect(taskTiming({ completed: false, deadlineDate: "2026-10-31" }, TODAY)).toBe("overdue");
  });
});

describe("taskTiming (completed tasks)", () => {
  it("is done-on-time when completed on the deadline day", () => {
    expect(
      taskTiming({ completed: true, deadlineDate: "2026-11-01", completionDate: "2026-11-01" }, TODAY)
    ).toBe("done-on-time");
  });

  it("is done-on-time when completed before the deadline", () => {
    expect(
      taskTiming({ completed: true, deadlineDate: "2026-11-05", completionDate: "2026-11-01" }, TODAY)
    ).toBe("done-on-time");
  });

  it("is done-late when completed after the deadline", () => {
    expect(
      taskTiming({ completed: true, deadlineDate: "2026-10-30", completionDate: "2026-11-01" }, TODAY)
    ).toBe("done-late");
  });

  it("is done-on-time when there is no deadline", () => {
    expect(taskTiming({ completed: true, completionDate: "2026-11-01" }, TODAY)).toBe("done-on-time");
  });

  it("stays done-late even if today is long after (not overdue)", () => {
    expect(
      taskTiming({ completed: true, deadlineDate: "2026-01-01", completionDate: "2026-01-03" }, TODAY)
    ).toBe("done-late");
  });
});

describe("lateCompletionDates", () => {
  it("collects only days on which a task was finished after its deadline", () => {
    const tasks = [
      { completed: true, deadlineDate: "2026-10-30", completionDate: "2026-11-01" }, // late
      { completed: true, deadlineDate: "2026-11-02", completionDate: "2026-11-02" }, // on time
      { completed: true, completionDate: "2026-11-03" }, // no deadline
      { completed: false, deadlineDate: "2026-10-01" }, // overdue but open
    ];
    expect([...lateCompletionDates(tasks, TODAY)]).toEqual(["2026-11-01"]);
  });

  it("returns an empty set when nothing was late", () => {
    expect(lateCompletionDates([{ completed: true, completionDate: "2026-11-01" }], TODAY).size).toBe(0);
  });
});
