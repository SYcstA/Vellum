import Database from "@tauri-apps/plugin-sql";
import type { Task, Note, LogEntry } from "./useAppStore";

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
  const rows = await d.select<
    {
      ID: number;
      Title: string;
      Category_Name: string;
      Status: string;
      Completion_Date: string | null;
      Deadline_Date: string | null;
    }[]
  >(
    `SELECT Tasks.ID, Tasks.Title, Categories.Name as Category_Name,
            Tasks.Status, Tasks.Completion_Date, Tasks.Deadline_Date
     FROM Tasks
     JOIN Categories ON Tasks.Category_ID = Categories.ID
     ORDER BY Tasks.ID`
  );
  return rows.map((r) => ({
    id: `t${r.ID}`,
    text: r.Title,
    category: r.Category_Name,
    completed: r.Status === "completed",
    completionDate: r.Completion_Date || undefined,
    deadlineDate: r.Deadline_Date || undefined,
  }));
}

/** Fetch all notes */
export async function fetchNotes(): Promise<Note[]> {
  const d = await getDb();
  const rows = await d.select<{ ID: number; Title: string; Content: string }[]>(
    "SELECT ID, Title, Content FROM Notes ORDER BY ID"
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
  const rows = await d.select<{ Title: string }[]>(
    `SELECT Title FROM Tasks WHERE ${column} = ?1`,
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
 * Create a new task with optional deadline.
 * Returns the generated task ID, category ID, and category name.
 */
export async function createTask(
  title: string,
  categoryName: string,
  deadlineDate?: string
): Promise<{ taskId: number; catId: number; catName: string }> {
  const d = await getDb();

  let catRows = await d.select<{ ID: number }[]>(
    "SELECT ID FROM Categories WHERE Name = ?1",
    [categoryName]
  );
  let catId: number;
  if (catRows.length === 0) {
    const result = await d.execute(
      "INSERT INTO Categories (Name) VALUES (?1)",
      [categoryName]
    );
    catId = result.lastInsertId as number;
  } else {
    catId = catRows[0].ID;
  }

  if (deadlineDate) {
    await d.execute(
      "INSERT INTO Tasks (Category_ID, Title, Status, Deadline_Date) VALUES (?1, ?2, 'pending', ?3)",
      [catId, title, deadlineDate]
    );
  } else {
    await d.execute(
      "INSERT INTO Tasks (Category_ID, Title, Status) VALUES (?1, ?2, 'pending')",
      [catId, title]
    );
  }

  // Get the last inserted task ID
  const lastRows = await d.select<{ ID: number }[]>(
    "SELECT MAX(ID) as ID FROM Tasks WHERE Category_ID = ?1 AND Title = ?2",
    [catId, title]
  );
  const taskId = lastRows[0]?.ID ?? 0;

  await logAction("TASK_CREATED", `Created task: "${title}" in [${categoryName}]`);

  return { taskId, catId, catName: categoryName };
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

/** Full update of a task's title, category, and/or deadline */
export async function updateTaskFull(
  taskId: number,
  title: string,
  categoryName: string,
  deadlineDate?: string
): Promise<void> {
  const d = await getDb();
  // Ensure the category exists
  let catRows = await d.select<{ ID: number }[]>(
    "SELECT ID FROM Categories WHERE Name = ?1",
    [categoryName]
  );
  let catId: number;
  if (catRows.length === 0) {
    const result = await d.execute(
      "INSERT INTO Categories (Name) VALUES (?1)",
      [categoryName]
    );
    catId = result.lastInsertId as number;
  } else {
    catId = catRows[0].ID;
  }
  // Update the task
  if (deadlineDate) {
    await d.execute(
      "UPDATE Tasks SET Title = ?1, Category_ID = ?2, Deadline_Date = ?3 WHERE ID = ?4",
      [title, catId, deadlineDate, taskId]
    );
  } else {
    await d.execute(
      "UPDATE Tasks SET Title = ?1, Category_ID = ?2, Deadline_Date = NULL WHERE ID = ?3",
      [title, catId, taskId]
    );
  }
  // Logging is owned by the mutate() wrapper in the store so the log entry is
  // emitted exactly once alongside the optimistic-UI lifecycle.
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