import { describe, expect, it } from "vitest";
import { backupFileName, parseBackup, preImportFileName, serializeBackup } from "./backup";

const sample = () => ({
  categories: [
    { ID: 1, Name: "Work" },
    { ID: 4, Name: "Home" },
  ],
  tasks: [
    {
      ID: 7, Category_ID: 1, Title: "Write report", Deadline_Date: "2026-11-05",
      Completion_Date: null, Status: "pending", Position: 7,
    },
    {
      ID: 9, Category_ID: 4, Title: "Laundry", Deadline_Date: null,
      Completion_Date: "2026-11-01", Status: "completed", Position: null,
    },
  ],
  taskTags: [
    { Task_ID: 7, Tag_ID: 1 },
    { Task_ID: 9, Tag_ID: 4 },
    { Task_ID: 9, Tag_ID: 1 },
  ],
  notes: [{ ID: 2, Title: "Ideas", Content: "<p>hi</p>", Position: 2 }],
  noteTaskTags: [{ Note_ID: 2, Task_ID: 7 }],
  logs: [
    { Timestamp: "2026-11-01 09:00:00", Action_Type: "TASK_ADDED", Detail: "x", Entity_Type: "task", Entity_ID: 7 },
    { Timestamp: "2026-11-01 09:01:00", Action_Type: "OTHER", Detail: "y", Entity_Type: null, Entity_ID: null },
  ],
});

/** Serialize the sample, apply `mutate` to the parsed JSON, return JSON text. */
const tampered = (mutate: (o: any) => void) => {
  const o = JSON.parse(serializeBackup(sample()));
  mutate(o);
  return JSON.stringify(o);
};

describe("serializeBackup / parseBackup", () => {
  it("round-trips all tables with IDs preserved", () => {
    const parsed = parseBackup(serializeBackup(sample()));
    const { app, version, exportedAt, ...tables } = parsed;
    expect(app).toBe("vellum");
    expect(version).toBe(1);
    expect(tables).toEqual(sample());
    expect(exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("stamps exportedAt from the supplied clock", () => {
    const json = serializeBackup(sample(), new Date("2026-11-01T02:00:00.000Z"));
    expect(parseBackup(json).exportedAt).toBe("2026-11-01T02:00:00.000Z");
  });

  it("accepts an empty database", () => {
    const empty = { categories: [], tasks: [], taskTags: [], notes: [], noteTaskTags: [], logs: [] };
    expect(parseBackup(serializeBackup(empty)).tasks).toEqual([]);
  });
});

describe("parseBackup rejects bad input", () => {
  it("rejects text that is not JSON", () => {
    expect(() => parseBackup("not json {")).toThrow(/valid JSON/i);
  });

  it("rejects JSON that is not an object", () => {
    expect(() => parseBackup("[1,2]")).toThrow(/object/i);
  });

  it("rejects a file from another app", () => {
    expect(() => parseBackup(tampered((o) => { o.app = "other"; }))).toThrow(/app/i);
  });

  it("rejects a newer backup version", () => {
    expect(() => parseBackup(tampered((o) => { o.version = 2; }))).toThrow(/version/i);
  });

  it("rejects a missing tasks array", () => {
    expect(() => parseBackup(tampered((o) => { delete o.tasks; }))).toThrow(/tasks/);
  });

  it("rejects a task with a non-numeric ID", () => {
    expect(() => parseBackup(tampered((o) => { o.tasks[0].ID = "7"; }))).toThrow(/tasks/);
  });

  it("rejects a task with a non-string title", () => {
    expect(() => parseBackup(tampered((o) => { o.tasks[0].Title = 5; }))).toThrow(/tasks/);
  });

  it("rejects duplicate IDs", () => {
    expect(() => parseBackup(tampered((o) => { o.categories[1].ID = 1; }))).toThrow(/categories/);
  });

  it("rejects an unknown task Status", () => {
    expect(() => parseBackup(tampered((o) => { o.tasks[0].Status = "done"; }))).toThrow(/Status/);
  });

  it("rejects a deadline that is not YYYY-MM-DD", () => {
    expect(() => parseBackup(tampered((o) => { o.tasks[0].Deadline_Date = "2026-1-5"; }))).toThrow(/Deadline_Date/);
  });

  it("rejects a completion date that is not YYYY-MM-DD", () => {
    expect(() => parseBackup(tampered((o) => { o.tasks[1].Completion_Date = "yesterday"; }))).toThrow(/Completion_Date/);
  });

  it("rejects duplicate category names (DB column is UNIQUE)", () => {
    expect(() => parseBackup(tampered((o) => { o.categories[1].Name = "Work"; }))).toThrow(/categories.*Name/);
  });

  it("rejects a duplicated taskTags pair (DB primary key)", () => {
    expect(() => parseBackup(tampered((o) => { o.taskTags.push({ ...o.taskTags[0] }); }))).toThrow(/taskTags.*duplicate/);
  });

  it("rejects a duplicated noteTaskTags pair (DB primary key)", () => {
    expect(() => parseBackup(tampered((o) => { o.noteTaskTags.push({ ...o.noteTaskTags[0] }); }))).toThrow(/noteTaskTags.*duplicate/);
  });

  it("rejects a task whose Category_ID does not exist", () => {
    expect(() => parseBackup(tampered((o) => { o.tasks[0].Category_ID = 99; }))).toThrow(/Category_ID/);
  });

  it("rejects a taskTags row pointing to a missing task", () => {
    expect(() => parseBackup(tampered((o) => { o.taskTags[0].Task_ID = 99; }))).toThrow(/taskTags/);
  });

  it("rejects a taskTags row pointing to a missing tag", () => {
    expect(() => parseBackup(tampered((o) => { o.taskTags[0].Tag_ID = 99; }))).toThrow(/taskTags/);
  });

  it("rejects a noteTaskTags row pointing to a missing note", () => {
    expect(() => parseBackup(tampered((o) => { o.noteTaskTags[0].Note_ID = 99; }))).toThrow(/noteTaskTags/);
  });

  it("rejects a noteTaskTags row pointing to a missing task", () => {
    expect(() => parseBackup(tampered((o) => { o.noteTaskTags[0].Task_ID = 99; }))).toThrow(/noteTaskTags/);
  });
});

describe("backup file names", () => {
  const d = new Date(2026, 10, 1, 9, 5, 7); // local 2026-11-01 09:05:07
  it("names a manual export by local date", () => {
    expect(backupFileName(d)).toBe("vellum-backup-2026-11-01.json");
  });
  it("names the automatic pre-import export by local date and time", () => {
    expect(preImportFileName(d)).toBe("vellum-pre-import-20261101-090507.json");
  });
});
