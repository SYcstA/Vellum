import Database from "@tauri-apps/plugin-sql";
import type { Task, Note, LogEntry } from "./useAppStore";
import type { BackupTables } from "./backup";

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (db) return db;
  db = await Database.load("sqlite:productivity.db");
  // NOTE: sqlx (plugin-sql's backend) already issues `PRAGMA foreign_keys = ON`
  // on every pooled connection by default, so ON DELETE CASCADE is reliably
  // active. This call reaffirms intent but only affects whichever pooled
  // connection serves it — it is NOT the actual guarantee, just documentation.
  try {
    await db.execute("PRAGMA foreign_keys = ON");
  } catch {
    // Non-fatal: the sqlx per-connection default already enforces this.
  }
  return db;
}

export async function initSchema(): Promise<void> {
  const d = await getDb();

  await d.execute(`
    CREATE TABLE IF NOT EXISTS Categories (
      ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Name TEXT NOT NULL UNIQUE
    )
  `);

  await d.execute(`
    CREATE TABLE IF NOT EXISTS Tasks (
      ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Category_ID INTEGER NOT NULL,
      Title TEXT NOT NULL,
      Deadline_Date TEXT,
      Completion_Date TEXT,
      Status TEXT NOT NULL DEFAULT 'pending',
      FOREIGN KEY (Category_ID) REFERENCES Categories(ID) ON DELETE CASCADE
    )
  `);

  // Phase 2: many-to-many Task↔Tag. Tasks.Category_ID stays as the "primary"
  // tag (preserves NOT NULL + existing log joins); Task_Tags holds the FULL set
  // (including the primary). Every task has >=1 tag.
  await d.execute(`
    CREATE TABLE IF NOT EXISTS Task_Tags (
      Task_ID INTEGER NOT NULL,
      Tag_ID INTEGER NOT NULL,
      PRIMARY KEY (Task_ID, Tag_ID),
      FOREIGN KEY (Task_ID) REFERENCES Tasks(ID) ON DELETE CASCADE,
      FOREIGN KEY (Tag_ID) REFERENCES Categories(ID) ON DELETE CASCADE
    )
  `);
  await d.execute("CREATE INDEX IF NOT EXISTS idx_tasktags_task ON Task_Tags(Task_ID)");
  await d.execute("CREATE INDEX IF NOT EXISTS idx_tasktags_tag ON Task_Tags(Tag_ID)");
  // Backfill primary category into Task_Tags. Idempotent (OR IGNORE), cheap.
  await d.execute("INSERT OR IGNORE INTO Task_Tags (Task_ID, Tag_ID) SELECT ID, Category_ID FROM Tasks WHERE Category_ID IS NOT NULL");

  await d.execute(`
    CREATE TABLE IF NOT EXISTS Notes (
      ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Title TEXT NOT NULL DEFAULT 'Untitled',
      Content TEXT NOT NULL
    )
  `);

  // Migration: add Title column if missing (pre-v5 databases)
  try {
    await d.execute("ALTER TABLE Notes ADD COLUMN Title TEXT NOT NULL DEFAULT 'Untitled'");
  } catch {
    // Column already exists — ignore
  }

  await d.execute(`
    CREATE TABLE IF NOT EXISTS Note_Task_Tags (
      Note_ID INTEGER NOT NULL,
      Task_ID INTEGER NOT NULL,
      PRIMARY KEY (Note_ID, Task_ID),
      FOREIGN KEY (Note_ID) REFERENCES Notes(ID) ON DELETE CASCADE,
      FOREIGN KEY (Task_ID) REFERENCES Tasks(ID) ON DELETE CASCADE
    )
  `);

  await d.execute(`
    CREATE TABLE IF NOT EXISTS Logs (
      ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Timestamp TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      Action_Type TEXT NOT NULL,
      Detail TEXT NOT NULL
    )
  `);

  // Phase 2: richer Logs columns so the Activity Log can deep-link back to the
  // entity it describes. SQLite has no `ADD COLUMN IF NOT EXISTS`, so guard each.
  try {
    await d.execute("ALTER TABLE Logs ADD COLUMN Entity_Type TEXT");
  } catch {
    // Column already exists — ignore
  }
  try {
    await d.execute("ALTER TABLE Logs ADD COLUMN Entity_ID INTEGER");
  } catch {
    // Column already exists — ignore
  }

  // Phase 4: manual drag-reorder needs a persisted sort key on Tasks + Notes.
  // Guarded ALTER (no ADD COLUMN IF NOT EXISTS in SQLite); backfill Position=ID
  // so existing rows keep their current (ID) order until the user drags.
  for (const tbl of ["Tasks", "Notes"]) {
    try {
      await d.execute(`ALTER TABLE ${tbl} ADD COLUMN Position INTEGER`);
    } catch {
      // Column already exists — ignore
    }
    await d.execute(`UPDATE ${tbl} SET Position = ID WHERE Position IS NULL`);
  }

  // Phase 2: indexes for the new read paths (calendar sync, bidirectional links,
  // category cascade, and reverse-chronological log reads).
  await d.execute("CREATE INDEX IF NOT EXISTS idx_ntt_task ON Note_Task_Tags(Task_ID)");
  await d.execute("CREATE INDEX IF NOT EXISTS idx_ntt_note ON Note_Task_Tags(Note_ID)");
  await d.execute("CREATE INDEX IF NOT EXISTS idx_tasks_cat ON Tasks(Category_ID)");
  await d.execute("CREATE INDEX IF NOT EXISTS idx_tasks_comp ON Tasks(Completion_Date)");
  await d.execute("CREATE INDEX IF NOT EXISTS idx_tasks_dead ON Tasks(Deadline_Date)");
  await d.execute("CREATE INDEX IF NOT EXISTS idx_logs_ts ON Logs(Timestamp DESC)");
}

/** Mark the database as "seeded" so older builds that DID insert placeholder
 *  rows can't re-seed on upgrade. Vellum ships a truly blank slate. */
export async function markSeeded(): Promise<void> {
  localStorage.setItem("vellum_seeded", "true");
}

/** Fetch all tasks with category name */
export async function fetchTasks(): Promise<Task[]> {
  const d = await getDb();
  // Aggregate ALL tags per task from Task_Tags. \x1f (unit separator) avoids
  // clashing with commas in tag names. group_concat order is unspecified in
  // SQLite, so we surface the primary (Category_ID → Primary_Name) separately
  // and float it to the front in JS. (A correlated ORDER BY referencing the
  // outer Tasks.Category_ID inside the aggregate subquery is rejected by SQLite.)
  const rows = await d.select<
    {
      ID: number;
      Title: string;
      Primary_Name: string;
      Tags: string | null;
      Status: string;
      Completion_Date: string | null;
      Deadline_Date: string | null;
    }[]
  >(
    `SELECT Tasks.ID, Tasks.Title, Tasks.Status, Tasks.Completion_Date, Tasks.Deadline_Date,
            PC.Name AS Primary_Name,
            (SELECT group_concat(C.Name, char(31))
               FROM Task_Tags TT JOIN Categories C ON TT.Tag_ID = C.ID
              WHERE TT.Task_ID = Tasks.ID) AS Tags
     FROM Tasks
     JOIN Categories PC ON Tasks.Category_ID = PC.ID
     ORDER BY Tasks.Position, Tasks.ID`
  );
  return rows.map((r) => {
    const raw = r.Tags ? r.Tags.split("\x1f") : [];
    // Primary first; fall back to the primary name if Task_Tags is somehow empty.
    const tags = raw.includes(r.Primary_Name)
      ? [r.Primary_Name, ...raw.filter((t) => t !== r.Primary_Name)]
      : raw.length > 0 ? raw : [r.Primary_Name];
    return {
      id: `t${r.ID}`,
      text: r.Title,
      tags,
      completed: r.Status === "completed",
      completionDate: r.Completion_Date || undefined,
      deadlineDate: r.Deadline_Date || undefined,
    };
  });
}

/** Get a category's ID, creating it if missing. */
async function getOrCreateCategoryId(d: Database, name: string): Promise<number> {
  const rows = await d.select<{ ID: number }[]>(
    "SELECT ID FROM Categories WHERE Name = ?1",
    [name]
  );
  if (rows.length > 0) return rows[0].ID;
  const result = await d.execute("INSERT INTO Categories (Name) VALUES (?1)", [name]);
  return result.lastInsertId as number;
}

/** Fetch all notes */
export async function fetchNotes(): Promise<Note[]> {
  const d = await getDb();
  const rows = await d.select<{ ID: number; Title: string; Content: string }[]>(
    "SELECT ID, Title, Content FROM Notes ORDER BY Position, ID"
  );
  return rows.map((r) => ({
    id: `n${r.ID}`,
    title: r.Title,
    text: r.Content,
  }));
}

/** Fetch all note-task link pairs */
export async function fetchNoteTaskLinks(): Promise<
  { noteId: string; taskId: string }[]
> {
  const d = await getDb();
  const rows = await d.select<{ Note_ID: number; Task_ID: number }[]>(
    "SELECT Note_ID, Task_ID FROM Note_Task_Tags"
  );
  return rows.map((r) => ({
    noteId: `n${r.Note_ID}`,
    taskId: `t${r.Task_ID}`,
  }));
}

/** Fetch tasks that have a date match (for calendar popover) */
export async function fetchTaskTitlesByDate(
  date: string,
  type: "completion" | "deadline"
): Promise<string[]> {
  const d = await getDb();
  const column = type === "completion" ? "Completion_Date" : "Deadline_Date";
  // A completed task's deadline is resolved: it shows under "Completed" only,
  // matching the calendar dots (a done task never also counts as a deadline).
  const pendingOnly = type === "deadline" ? "AND Status <> 'completed'" : "";
  const rows = await d.select<{ Title: string }[]>(
    `SELECT Title FROM Tasks WHERE ${column} = ?1 ${pendingOnly}`,
    [date]
  );
  return rows.map((r) => r.Title);
}

/** Get all unique category names (tags) */
export async function fetchAllTags(): Promise<string[]> {
  const d = await getDb();
  const rows = await d.select<{ Name: string }[]>(
    "SELECT Name FROM Categories ORDER BY Name"
  );
  return rows.map((r) => r.Name);
}

/**
 * Create a new task with >=1 tag and optional deadline. tags[0] becomes the
 * primary (Category_ID); ALL tags are mirrored into Task_Tags.
 * Returns the generated task ID + the primary category id/name.
 */
export async function createTask(
  title: string,
  tags: string[],
  deadlineDate?: string
): Promise<{ taskId: number; catId: number; catName: string }> {
  const d = await getDb();
  const cleanTags = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)));
  if (cleanTags.length === 0) cleanTags.push("General");

  const primaryId = await getOrCreateCategoryId(d, cleanTags[0]);

  if (deadlineDate) {
    await d.execute(
      "INSERT INTO Tasks (Category_ID, Title, Status, Deadline_Date) VALUES (?1, ?2, 'pending', ?3)",
      [primaryId, title, deadlineDate]
    );
  } else {
    await d.execute(
      "INSERT INTO Tasks (Category_ID, Title, Status) VALUES (?1, ?2, 'pending')",
      [primaryId, title]
    );
  }

  const lastRows = await d.select<{ ID: number }[]>(
    "SELECT MAX(ID) as ID FROM Tasks WHERE Category_ID = ?1 AND Title = ?2",
    [primaryId, title]
  );
  const taskId = lastRows[0]?.ID ?? 0;

  // Mirror every tag (incl. primary) into Task_Tags.
  for (const name of cleanTags) {
    const catId = await getOrCreateCategoryId(d, name);
    await d.execute("INSERT OR IGNORE INTO Task_Tags (Task_ID, Tag_ID) VALUES (?1, ?2)", [taskId, catId]);
  }

  await logAction("TASK_CREATED", `Created task: "${title}" in [${cleanTags.join(", ")}]`);

  return { taskId, catId: primaryId, catName: cleanTags[0] };
}

/** Add a single tag to a task (creates the category if missing). */
export async function addTaskTag(taskId: number, tagName: string): Promise<void> {
  const d = await getDb();
  const catId = await getOrCreateCategoryId(d, tagName.trim());
  await d.execute("INSERT OR IGNORE INTO Task_Tags (Task_ID, Tag_ID) VALUES (?1, ?2)", [taskId, catId]);
  await logAction("TASK_EDITED", `Tagged task #${taskId} with [${tagName}]`);
}

/** Remove a tag from a task. Refuses to drop the last tag; repoints the primary
 *  (Category_ID) to a surviving tag if the removed one was primary. */
export async function removeTaskTag(taskId: number, tagName: string): Promise<void> {
  const d = await getDb();
  const rows = await d.select<{ ID: number }[]>("SELECT ID FROM Categories WHERE Name = ?1", [tagName]);
  if (rows.length === 0) return;
  const tagId = rows[0].ID;

  const remaining = await d.select<{ Tag_ID: number }[]>(
    "SELECT Tag_ID FROM Task_Tags WHERE Task_ID = ?1 AND Tag_ID != ?2",
    [taskId, tagId]
  );
  if (remaining.length === 0) return; // never leave a task tag-less

  await d.execute("DELETE FROM Task_Tags WHERE Task_ID = ?1 AND Tag_ID = ?2", [taskId, tagId]);
  // If we removed the primary, repoint Category_ID to a survivor.
  await d.execute(
    "UPDATE Tasks SET Category_ID = ?1 WHERE ID = ?2 AND Category_ID = ?3",
    [remaining[0].Tag_ID, taskId, tagId]
  );
  await logAction("TASK_EDITED", `Removed tag [${tagName}] from task #${taskId}`);
}

/** Update task title (inline edit) */
export async function updateTaskTitle(
  taskId: number,
  newTitle: string
): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE Tasks SET Title = ?1 WHERE ID = ?2", [
    newTitle,
    taskId,
  ]);
  await logAction("TASK_EDITED", `Renamed task to: "${newTitle}"`);
}

/** Full update of a task's title, tag set, and/or deadline. tags[0] = primary;
 *  Task_Tags is replaced with the new set. */
export async function updateTaskFull(
  taskId: number,
  title: string,
  tags: string[],
  deadlineDate?: string
): Promise<void> {
  const d = await getDb();
  const cleanTags = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)));
  if (cleanTags.length === 0) cleanTags.push("General");

  const primaryId = await getOrCreateCategoryId(d, cleanTags[0]);

  if (deadlineDate) {
    await d.execute(
      "UPDATE Tasks SET Title = ?1, Category_ID = ?2, Deadline_Date = ?3 WHERE ID = ?4",
      [title, primaryId, deadlineDate, taskId]
    );
  } else {
    await d.execute(
      "UPDATE Tasks SET Title = ?1, Category_ID = ?2, Deadline_Date = NULL WHERE ID = ?3",
      [title, primaryId, taskId]
    );
  }

  // Replace the tag set.
  await d.execute("DELETE FROM Task_Tags WHERE Task_ID = ?1", [taskId]);
  for (const name of cleanTags) {
    const catId = await getOrCreateCategoryId(d, name);
    await d.execute("INSERT OR IGNORE INTO Task_Tags (Task_ID, Tag_ID) VALUES (?1, ?2)", [taskId, catId]);
  }
  // Logging is owned by the mutate() wrapper in the store.
}

/** Update note title */
export async function updateNoteTitle(
  noteId: number,
  newTitle: string
): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE Notes SET Title = ?1 WHERE ID = ?2", [
    newTitle,
    noteId,
  ]);
}

/** Update note content */
export async function updateNoteContent(
  noteId: number,
  content: string
): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE Notes SET Content = ?1 WHERE ID = ?2", [
    content,
    noteId,
  ]);
}

/** Toggle task completion */
export async function toggleTaskCompletion(
  taskId: number,
  currentlyCompleted: boolean
): Promise<void> {
  const d = await getDb();

  if (currentlyCompleted) {
    await d.execute(
      "UPDATE Tasks SET Status = 'pending', Completion_Date = NULL WHERE ID = ?1",
      [taskId]
    );
    const rows = await d.select<{ Title: string }[]>(
      "SELECT Title FROM Tasks WHERE ID = ?1",
      [taskId]
    );
    if (rows.length > 0) {
      const catRows = await d.select<{ Name: string }[]>(
        `SELECT Categories.Name FROM Tasks JOIN Categories ON Tasks.Category_ID = Categories.ID WHERE Tasks.ID = ?1`,
        [taskId]
      );
      const cat = catRows.length > 0 ? catRows[0].Name : "";
      await logAction("TASK_REOPENED", `Reopened task: "${rows[0].Title}" in [${cat}]`);
    }
  } else {
    await d.execute(
      "UPDATE Tasks SET Status = 'completed', Completion_Date = date('now','localtime') WHERE ID = ?1",
      [taskId]
    );
    const rows = await d.select<{ Title: string; Category_Name: string }[]>(
      `SELECT Tasks.Title, Categories.Name as Category_Name FROM Tasks JOIN Categories ON Tasks.Category_ID = Categories.ID WHERE Tasks.ID = ?1`,
      [taskId]
    );
    if (rows.length > 0) {
      await logAction("TASK_COMPLETED", `Completed task: "${rows[0].Title}" in [${rows[0].Category_Name}]`);
    }
  }
}

/** Link a note to a task */
export async function linkNoteToTask(
  noteId: number,
  taskId: number
): Promise<void> {
  const d = await getDb();
  await d.execute(
    "INSERT OR IGNORE INTO Note_Task_Tags (Note_ID, Task_ID) VALUES (?1, ?2)",
    [noteId, taskId]
  );
  await logAction("NOTE_LINKED", `Linked note #${noteId} to task #${taskId}`);
}

/** Unlink a note from a task */
export async function unlinkNoteFromTask(
  noteId: number,
  taskId: number
): Promise<void> {
  const d = await getDb();
  await d.execute(
    "DELETE FROM Note_Task_Tags WHERE Note_ID = ?1 AND Task_ID = ?2",
    [noteId, taskId]
  );
}

/**
 * Link a note to ALL tasks within a tag (category).
 * Does NOT clear existing links — supports one-to-many.
 */
export async function linkNoteToTag(
  noteId: number,
  tagName: string
): Promise<void> {
  const d = await getDb();
  // Find all task IDs with this category
  const rows = await d.select<{ ID: number }[]>(
    `SELECT Tasks.ID FROM Tasks
     JOIN Categories ON Tasks.Category_ID = Categories.ID
     WHERE Categories.Name = ?1`,
    [tagName]
  );
  let linkedCount = 0;
  for (const r of rows) {
    const result = await d.execute(
      "INSERT OR IGNORE INTO Note_Task_Tags (Note_ID, Task_ID) VALUES (?1, ?2)",
      [noteId, r.ID]
    );
    if (result.rowsAffected > 0) linkedCount++;
  }
  if (linkedCount > 0) {
    await logAction("NOTE_LINKED", `Linked note #${noteId} to tag "${tagName}" (${linkedCount} tasks)`);
  }
}

/** Rename a category */
export async function renameCategory(
  categoryId: number,
  newName: string
): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE Categories SET Name = ?1 WHERE ID = ?2", [
    newName,
    categoryId,
  ]);
  await logAction("CATEGORY_RENAMED", `Renamed category to: "${newName}"`);
}

/**
 * Delete a category by ID. Associated tasks (and, transitively, their
 * Note_Task_Tags links) are removed by SQLite via ON DELETE CASCADE — sqlx
 * enables PRAGMA foreign_keys per connection by default, so the cascade is live.
 * Logging is owned by the mutate() wrapper in the store (emitted exactly once).
 */
export async function deleteCategory(categoryId: number): Promise<void> {
  const d = await getDb();
  await d.execute("DELETE FROM Categories WHERE ID = ?1", [categoryId]);
}

/** Create a new category. Returns the generated ID. */
export async function createCategory(
  name: string
): Promise<{ catId: number }> {
  const d = await getDb();
  const result = await d.execute("INSERT INTO Categories (Name) VALUES (?1)", [
    name,
  ]);
  const catId = result.lastInsertId as number;
  await logAction("CATEGORY_CREATED", `Created category: "${name}"`);
  return { catId };
}

/** Delete a task by ID */
export async function deleteTask(taskId: number): Promise<void> {
  const d = await getDb();
  await d.execute("DELETE FROM Tasks WHERE ID = ?1", [taskId]);
  // Log happens in the store since we already have the task data
}

/** Delete a note by ID */
export async function deleteNote(noteId: number): Promise<void> {
  const d = await getDb();
  await d.execute("DELETE FROM Notes WHERE ID = ?1", [noteId]);
}

/**
 * Create a new note.
 * Returns the generated note ID.
 */
export async function createNote(
  title: string,
  content: string
): Promise<{ noteId: number }> {
  const d = await getDb();
  const result = await d.execute(
    "INSERT INTO Notes (Title, Content) VALUES (?1, ?2)",
    [title, content]
  );
  const noteId = result.lastInsertId as number;
  await logAction("NOTE_CREATED", `Created note: "${title}"`);
  return { noteId };
}

/** Fetch all logs */
export async function fetchLogs(): Promise<LogEntry[]> {
  const d = await getDb();
  const rows = await d.select<
    { ID: number; Timestamp: string; Action_Type: string; Detail: string }[]
  >("SELECT ID, Timestamp, Action_Type, Detail FROM Logs ORDER BY ID DESC");
  return rows.map((r) => ({
    id: r.ID,
    timestamp: r.Timestamp,
    actionType: r.Action_Type,
    detail: r.Detail,
  }));
}

/** Factory reset: delete all data from all tables */
export async function factoryReset(): Promise<void> {
  const d = await getDb();
  await d.execute("DELETE FROM Note_Task_Tags");
  await d.execute("DELETE FROM Logs");
  await d.execute("DELETE FROM Notes");
  await d.execute("DELETE FROM Tasks");
  await d.execute("DELETE FROM Categories");
  // Reset AUTOINCREMENT counters so next records start from id=1 again.
  try { await d.execute("DELETE FROM sqlite_sequence"); } catch {}
  // Keep `vellum_seeded` set so markSeeded() does NOT repopulate placeholders
  // on the next launch — true blank slate.
  localStorage.setItem("vellum_seeded", "true");
  // Re-trigger onboarding (95% centered window + default widget layout) on the
  // NEXT launch — user explicitly asked for a full re-init after factory reset.
  localStorage.removeItem("vellum_first_open");
  localStorage.removeItem("is_fake_maximized");
}

/** Persist a manual drag order: Position = index in the given id list. */
export async function reorderTasksDb(orderedIds: number[]): Promise<void> {
  const d = await getDb();
  for (let i = 0; i < orderedIds.length; i++) {
    await d.execute("UPDATE Tasks SET Position = ?1 WHERE ID = ?2", [i, orderedIds[i]]);
  }
}

/** Persist a manual drag order for notes. */
export async function reorderNotesDb(orderedIds: number[]): Promise<void> {
  const d = await getDb();
  for (let i = 0; i < orderedIds.length; i++) {
    await d.execute("UPDATE Notes SET Position = ?1 WHERE ID = ?2", [i, orderedIds[i]]);
  }
}

/** Log an action */
export async function logAction(
  actionType: string,
  detail: string
): Promise<void> {
  const d = await getDb();
  await d.execute(
    "INSERT INTO Logs (Action_Type, Detail) VALUES (?1, ?2)",
    [actionType, detail]
  );
}
/** Snapshot every table verbatim (IDs included) for a JSON backup. */
export async function dumpTables(): Promise<BackupTables> {
  const d = await getDb();
  const [categories, tasks, taskTags, notes, noteTaskTags, logs] = await Promise.all([
    d.select<BackupTables["categories"]>("SELECT ID, Name FROM Categories ORDER BY ID"),
    d.select<BackupTables["tasks"]>(
      "SELECT ID, Category_ID, Title, Deadline_Date, Completion_Date, Status, Position FROM Tasks ORDER BY ID"
    ),
    d.select<BackupTables["taskTags"]>("SELECT Task_ID, Tag_ID FROM Task_Tags ORDER BY Task_ID, Tag_ID"),
    d.select<BackupTables["notes"]>("SELECT ID, Title, Content, Position FROM Notes ORDER BY ID"),
    d.select<BackupTables["noteTaskTags"]>(
      "SELECT Note_ID, Task_ID FROM Note_Task_Tags ORDER BY Note_ID, Task_ID"
    ),
    d.select<BackupTables["logs"]>(
      "SELECT Timestamp, Action_Type, Detail, Entity_Type, Entity_ID FROM Logs ORDER BY ID"
    ),
  ]);
  return { categories, tasks, taskTags, notes, noteTaskTags, logs };
}

/**
 * Replace ALL data with a backup, keeping IDs so links stay valid.
 * Caller must have run `parseBackup` first (nothing is validated here) and
 * should have exported the current data: this is NOT atomic (see the
 * atomicity caveat in useAppStore.ts), so a mid-way failure leaves a
 * partial DB that only that pre-import export can repair.
 */
export async function replaceAllTables(b: BackupTables): Promise<void> {
  const d = await getDb();
  for (const t of ["Note_Task_Tags", "Task_Tags", "Logs", "Notes", "Tasks", "Categories"]) {
    await d.execute(`DELETE FROM ${t}`);
  }
  // Reset AUTOINCREMENT counters; the explicit-ID inserts below re-seed them
  // to each table's max ID, so rows added after import never collide.
  try { await d.execute("DELETE FROM sqlite_sequence"); } catch {}

  for (const c of b.categories) {
    await d.execute("INSERT INTO Categories (ID, Name) VALUES (?1, ?2)", [c.ID, c.Name]);
  }
  for (const t of b.tasks) {
    await d.execute(
      "INSERT INTO Tasks (ID, Category_ID, Title, Deadline_Date, Completion_Date, Status, Position) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      [t.ID, t.Category_ID, t.Title, t.Deadline_Date, t.Completion_Date, t.Status, t.Position]
    );
  }
  for (const r of b.taskTags) {
    await d.execute("INSERT INTO Task_Tags (Task_ID, Tag_ID) VALUES (?1, ?2)", [r.Task_ID, r.Tag_ID]);
  }
  for (const n of b.notes) {
    await d.execute(
      "INSERT INTO Notes (ID, Title, Content, Position) VALUES (?1, ?2, ?3, ?4)",
      [n.ID, n.Title, n.Content, n.Position]
    );
  }
  for (const r of b.noteTaskTags) {
    await d.execute("INSERT INTO Note_Task_Tags (Note_ID, Task_ID) VALUES (?1, ?2)", [r.Note_ID, r.Task_ID]);
  }
  for (const l of b.logs) {
    await d.execute(
      "INSERT INTO Logs (Timestamp, Action_Type, Detail, Entity_Type, Entity_ID) VALUES (?1, ?2, ?3, ?4, ?5)",
      [l.Timestamp, l.Action_Type, l.Detail, l.Entity_Type, l.Entity_ID]
    );
  }
}
