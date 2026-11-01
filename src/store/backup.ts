/** JSON backup format for Vellum. Pure: no Tauri / DB access here. */

export type BackupV1 = {
  app: "vellum";
  version: 1;
  exportedAt: string; // ISO
  categories: { ID: number; Name: string }[];
  tasks: {
    ID: number;
    Category_ID: number;
    Title: string;
    Deadline_Date: string | null;
    Completion_Date: string | null;
    Status: string;
    Position: number | null;
  }[];
  taskTags: { Task_ID: number; Tag_ID: number }[];
  notes: { ID: number; Title: string; Content: string; Position: number | null }[];
  noteTaskTags: { Note_ID: number; Task_ID: number }[];
  logs: {
    Timestamp: string;
    Action_Type: string;
    Detail: string;
    Entity_Type: string | null;
    Entity_ID: number | null;
  }[];
};

export type BackupTables = Omit<BackupV1, "app" | "version" | "exportedAt">;

export function serializeBackup(t: BackupTables, now: Date = new Date()): string {
  const out: BackupV1 = {
    app: "vellum",
    version: 1,
    exportedAt: now.toISOString(),
    categories: t.categories,
    tasks: t.tasks,
    taskTags: t.taskTags,
    notes: t.notes,
    noteTaskTags: t.noteTaskTags,
    logs: t.logs,
  };
  return JSON.stringify(out, null, 2);
}

type Kind = "int" | "str" | "intOrNull" | "strOrNull";
type Shape = Record<string, Kind>;

const SHAPES: Record<keyof BackupTables, Shape> = {
  categories: { ID: "int", Name: "str" },
  tasks: {
    ID: "int", Category_ID: "int", Title: "str", Deadline_Date: "strOrNull",
    Completion_Date: "strOrNull", Status: "str", Position: "intOrNull",
  },
  taskTags: { Task_ID: "int", Tag_ID: "int" },
  notes: { ID: "int", Title: "str", Content: "str", Position: "intOrNull" },
  noteTaskTags: { Note_ID: "int", Task_ID: "int" },
  logs: {
    Timestamp: "str", Action_Type: "str", Detail: "str",
    Entity_Type: "strOrNull", Entity_ID: "intOrNull",
  },
};

function kindOk(v: unknown, k: Kind): boolean {
  switch (k) {
    case "int": return Number.isInteger(v);
    case "str": return typeof v === "string";
    case "intOrNull": return v === null || Number.isInteger(v);
    case "strOrNull": return v === null || typeof v === "string";
  }
}

function fail(msg: string): never {
  throw new Error(`Invalid backup: ${msg}`);
}

/**
 * Parse + fully validate a backup. Throws a readable Error on the first
 * problem; callers must not touch the DB until this returns.
 */
export function parseBackup(json: string): BackupV1 {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    fail("file is not valid JSON.");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail("top level must be an object.");
  }
  const o = raw as Record<string, unknown>;
  if (o.app !== "vellum") fail('field "app" is not "vellum" (wrong file?).');
  if (o.version !== 1) {
    fail(`unsupported version ${JSON.stringify(o.version)} (this build reads version 1).`);
  }
  if (typeof o.exportedAt !== "string") fail('field "exportedAt" must be a string.');

  for (const table of Object.keys(SHAPES) as (keyof BackupTables)[]) {
    const rows = o[table];
    if (!Array.isArray(rows)) fail(`field "${table}" must be an array.`);
    const shape = SHAPES[table];
    rows.forEach((row, i) => {
      if (typeof row !== "object" || row === null) fail(`${table}[${i}] must be an object.`);
      for (const [col, kind] of Object.entries(shape)) {
        if (!kindOk((row as Record<string, unknown>)[col], kind)) {
          fail(`${table}[${i}].${col} has the wrong type.`);
        }
      }
    });
  }

  const b = o as unknown as BackupV1;

  const idSet = (table: "categories" | "tasks" | "notes") => {
    const ids = new Set<number>();
    for (const r of b[table]) {
      if (ids.has(r.ID)) fail(`${table} has duplicate ID ${r.ID}.`);
      ids.add(r.ID);
    }
    return ids;
  };
  const cats = idSet("categories");
  const tasks = idSet("tasks");
  const notes = idSet("notes");

  const names = new Set<string>();
  for (const c of b.categories) {
    if (names.has(c.Name)) fail(`categories has duplicate Name "${c.Name}".`);
    names.add(c.Name);
  }

  b.tasks.forEach((t, i) => {
    if (!cats.has(t.Category_ID)) fail(`tasks[${i}].Category_ID ${t.Category_ID} does not exist in categories.`);
  });
  b.taskTags.forEach((r, i) => {
    if (!tasks.has(r.Task_ID)) fail(`taskTags[${i}].Task_ID ${r.Task_ID} does not exist in tasks.`);
    if (!cats.has(r.Tag_ID)) fail(`taskTags[${i}].Tag_ID ${r.Tag_ID} does not exist in categories.`);
  });
  b.noteTaskTags.forEach((r, i) => {
    if (!notes.has(r.Note_ID)) fail(`noteTaskTags[${i}].Note_ID ${r.Note_ID} does not exist in notes.`);
    if (!tasks.has(r.Task_ID)) fail(`noteTaskTags[${i}].Task_ID ${r.Task_ID} does not exist in tasks.`);
  });

  const noDupPairs = (table: "taskTags" | "noteTaskTags", a: string, c: string) => {
    const seen = new Set<string>();
    (b[table] as Record<string, number>[]).forEach((r, i) => {
      const key = `${r[a]}:${r[c]}`;
      if (seen.has(key)) fail(`${table}[${i}] is a duplicate (${a} ${r[a]}, ${c} ${r[c]}).`);
      seen.add(key);
    });
  };
  noDupPairs("taskTags", "Task_ID", "Tag_ID");
  noDupPairs("noteTaskTags", "Note_ID", "Task_ID");

  return b;
}
