# State of the Union — Productivity Desktop App

## 1. Database Architecture (SQLite via Tauri Plugin)

### Connection Layer
- File: `src/store/db.ts`
- Singleton pattern via `getDb()`: lazily initializes `Database.load("sqlite:productivity.db")` on first call, caches the instance
- No connection pooling — single shared `let db: Database | null = null`

### Exact SQL Schema (created by `initSchema()`)

**Categories Table**
```sql
CREATE TABLE IF NOT EXISTS Categories (
  ID INTEGER PRIMARY KEY AUTOINCREMENT,
  Name TEXT NOT NULL UNIQUE
);
```

**Tasks Table**
```sql
CREATE TABLE IF NOT EXISTS Tasks (
  ID INTEGER PRIMARY KEY AUTOINCREMENT,
  Category_ID INTEGER NOT NULL,
  Title TEXT NOT NULL,
  Deadline_Date TEXT,
  Completion_Date TEXT,
  Status TEXT NOT NULL DEFAULT 'pending',
  FOREIGN KEY (Category_ID) REFERENCES Categories(ID) ON DELETE CASCADE
);
```

**Notes Table**
```sql
CREATE TABLE IF NOT EXISTS Notes (
  ID INTEGER PRIMARY KEY AUTOINCREMENT,
  Title TEXT NOT NULL DEFAULT 'Untitled',
  Content TEXT NOT NULL
);
```
- A migration `ALTER TABLE Notes ADD COLUMN Title` is attempted on each boot (silent-fail via try/catch for pre-v5 databases)

**Note_Task_Tags (Junction Table)**
```sql
CREATE TABLE IF NOT EXISTS Note_Task_Tags (
  Note_ID INTEGER NOT NULL,
  Task_ID INTEGER NOT NULL,
  PRIMARY KEY (Note_ID, Task_ID),
  FOREIGN KEY (Note_ID) REFERENCES Notes(ID) ON DELETE CASCADE,
  FOREIGN KEY (Task_ID) REFERENCES Tasks(ID) ON DELETE CASCADE
);
```

**Logs Table**
```sql
CREATE TABLE IF NOT EXISTS Logs (
  ID INTEGER PRIMARY KEY AUTOINCREMENT,
  Timestamp TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  Action_Type TEXT NOT NULL,
  Detail TEXT NOT NULL
);
```

### Foreign Key & Cascade Summary
- `Tasks.Category_ID → Categories.ID` with **ON DELETE CASCADE** — deleting a category deletes all its tasks
- `Note_Task_Tags.Note_ID → Notes.ID` with **ON DELETE CASCADE**
- `Note_Task_Tags.Task_ID → Tasks.ID` with **ON DELETE CASCADE**
- Notes are stand-alone (no FK to Categories)

### Seed Data
`seedData()` checks `SELECT COUNT(*) FROM Categories` — if 0, inserts 3 categories ("Academic & Admin", "GRC Internship", "Language & Education"), 3 tasks (one per category), 2 notes, 2 junction rows (note1→task2, note2→task3), and a SYSTEM log entry.

### Exported Functions in db.ts
`initSchema`, `seedData`, `fetchTasks`, `fetchNotes`, `fetchLogs`, `fetchCalendarDates`, `fetchNoteTaskLinks`, `fetchTaskTitlesByDate`, `fetchAllTags`, `createTask`, `updateTaskTitle`, `updateNoteTitle`, `toggleTaskCompletion`, `linkNoteToTask`, `unlinkNoteFromTask`, `linkNoteToTag`, `deleteTask`, `deleteNote`, `createNote`, `factoryReset`, `logAction` (internal).

---

## 2. State Management (Zustand)

### State Variables in `useAppStore.ts`

**Widget Visibility (booleans):**
- `isToDoOpen`, `isCalendarOpen`, `isNotesOpen`, `isLogOpen`, `isSettingsOpen`

**Data Arrays:**
- `tasks: Task[]` — each Task: `{ id: string (e.g. "t1"), text, category, completed, completionDate?, deadlineDate? }`
- `notes: Note[]` — each Note: `{ id: string (e.g. "n1"), title, text }`
- `logs: LogEntry[]` — each LogEntry: `{ id: number, timestamp, actionType, detail }`
- `calendarDates: CalendarDate[]` — each CalendarDate: `{ date: string, type: "completion"|"deadline", taskId: number }`
- `noteTaskLinks: { noteId: string, taskId: string }[]`
- `tags: string[]` — extracted from `Categories.Name`

**Metadata:**
- `loading: boolean`, `loaded: boolean`
- `highlightedNoteId: string | null` — used for bi-directional linking from ToDoWidget
- `datePopup: DateTaskPopup | null` — (legacy, not actively used by Calendar popover)

**Toggles:**
- `toggleToDo`, `toggleCalendar`, `toggleNotes`, `toggleLog`, `toggleSettings`
- `openNotesWithHighlight(noteId)` — sets `isNotesOpen: true` + `highlightedNoteId`

**Actions:**
- `loadData()` — fetches tasks/notes/calendarDates/noteTaskLinks/tags via `Promise.all`
- `addTask(title, categoryName, deadlineDate?)` — calls `createTask()` in SQL, then re-fetches tasks + calendarDates + tags
- `toggleTask(taskId, currentlyCompleted)` — **optimistic UI update** (immediately flips `completed` in state), then calls `toggleTaskCompletion()` in SQL, then re-fetches tasks + calendarDates
- `editTaskTitle(taskId, newTitle)` / `editNoteTitle(noteId, newTitle)` — SQL update → re-fetch tasks/notes
- `deleteTaskById(taskId)` / `deleteNoteById(noteId)` — SQL delete → re-fetch state
- `addNote(title, content)` — SQL insert → re-fetch notes + links
- `resetAllData()` — calls `factoryReset()` → clears all state arrays to empty
- `linkNote(noteId, taskId)` / `unlinkNote(noteId, taskId)` / `linkNoteToTagName(noteId, tagName)` — SQL → re-fetch noteTaskLinks
- `refreshLogs()` / `refreshTags()` / `refreshNoteTaskLinks()` — pure re-fetch

### Sync Pattern
**Predominantly "refetch everything" after every mutation.** For example, `addTask` calls `createTask` in SQL, then re-fetches tasks, calendarDates, and tags — 3 separate SQL queries. The only optimistic update is in `toggleTask`, where the UI shows the completion circle flipped immediately before the SQL write completes. However, it still re-fetches afterward. This means every mutation triggers 2–5 round-trip SQL queries.

---

## 3. Frontend & Widget Architecture

### Core React Components

| Component | File | Responsibility |
|-----------|------|----------------|
| `App` | `src/App.tsx` | Boot sequence (initSchema → seedData → loadData), renders all widgets conditionally + MasterDock |
| `MasterDock` | `src/components/MasterDock.tsx` | Fixed bottom-center bar with 5 toggle buttons (To-Do, Calendar, Notes, Log, Settings) |
| `ToDoWidget` | `src/components/ToDoWidget.tsx` | Task CRUD with add form, category filter pills, inline autocomplete, expandable completed section (Framer Motion animated), inline editing, bi-directional linking via click, custom delete modal |
| `CalendarWidget` | `src/components/CalendarWidget.tsx` | Monthly grid, green dots for completions, amber dots for deadlines, date-click popover with task titles, month navigation |
| `NotesWidget` | `src/components/NotesWidget.tsx` | Split-pane: left sidebar (note list + "+ New Note" button), right pane with 1-click editable title + content, "Link to tags" accordion at bottom |
| `LogWidget` | `src/components/LogWidget.tsx` | Chronological log entries with color-coded action types, auto-refresh on mount |
| `SettingsWidget` | `src/components/SettingsWidget.tsx` | Factory Reset button with custom ConfirmModal |
| `ConfirmModal` | `src/components/ConfirmModal.tsx` | Reusable glassmorphism modal with backdrop blur, Escape/Enter support, auto-focused confirm button |

### Bi-Directional Linking Flow
1. **Task → Note:** In ToDoWidget, clicking a task's text calls `handleTaskClick(taskId)` → filters `noteTaskLinks` for matches → calls `openNotesWithHighlight(linkedNoteId)` → opens NotesWidget and scrolls to the highlighted note via `highlightRef.current.scrollIntoView()`
2. **Note → Tasks:** In NotesWidget's "Link to tags…" section, each tag pill toggles `linkNoteToTagName` (which links the note to ALL tasks in that category) or `unlinkNote` (per-task)

### Rnd Configuration
Every widget uses `react-rnd` v10.5.3 with:
- `default={{ x, y, width, height }}` — fixed starting positions
- `bounds="window"` — prevents dragging off-screen
- `dragHandleClassName="drag-header"` — only draggable by the title bar
- `enableResizing` — all 8 directions enabled
- `process.env` polyfill via `window.process = { env: {} }` in `index.html` and `define: { "process.env": "{}" }` in `vite.config.ts` (required for react-draggable dependency inside react-rnd)

### Framer Motion Usage
In ToDoWidget's completed section:
- ▶ arrow: `<motion.span animate={{ rotate: expanded ? 90 : 0 }} transition={{ duration: 0.2 }}>`
- Expandable container: `<AnimatePresence>` wrapping `<motion.div>` with `initial={{ height: 0, opacity: 0 }}` → `animate={{ height: "auto", opacity: 1 }}` → `exit={{ height: 0, opacity: 0 }}` with `transition={{ duration: 0.25, ease: "easeInOut" }}`

### 1-Click Note Editing
- Title: transparent `<input>` with `className="bg-transparent px-0 py-1 text-sm font-semibold text-white/90 outline-none border-none cursor-text"` — writes to SQLite on every `onChange` via `editNoteTitle()`
- Content: transparent `<textarea>` with `className="w-full h-full bg-transparent text-sm leading-relaxed text-white/70 outline-none border-none resize-none"` — updates local state only (SQL write pending for future implementation)

---

## 4. Backend & Tauri Configuration

### Rust Commands
**Zero custom `#[tauri::command]` functions.** We rely 100% on frontend-direct SQL calls via `@tauri-apps/plugin-sql`. The Rust backend (`lib.rs`) only registers the plugin:
```rust
tauri::Builder::default()
    .plugin(tauri_plugin_sql::Builder::default().build())
    .run(tauri::generate_context!())
```

### Cargo Dependencies
- `tauri = "2"` (no features beyond defaults)
- `tauri-plugin-opener = "2"` (for opening URLs/files — unused by our code)
- `tauri-plugin-sql = { version = "2", features = ["sqlite"] }`
- `serde + serde_json` (unused directly — brought in by tauri-plugin-sql)

### Window Configuration (`tauri.conf.json`)
```json
{
  "decorations": false,         // Frameless window — no title bar, no borders
  "transparent": true,           // Window background is transparent (see-through)
  "visible": true,               // Starts visible (could be changed to false)
  "dragDropEnabled": false,      // Prevents OS from intercepting drag events in the frameless window
  "devtools": true               // DevTools enabled for debugging
}
```

### Capabilities (`capabilities/default.json`)
```json
["core:default", "opener:default", "sql:default", "sql:allow-execute", "sql:allow-select"]
```
- `sql:allow-execute` — required for INSERT/UPDATE/DELETE queries
- `sql:allow-select` — required for SELECT queries
- No custom capability scopes defined (SQL operations are unrestricted on the `sqlite:productivity.db` database)

### CSS Configuration
- `@import "tailwindcss"` — Tailwind CSS v4 via Vite plugin
- `background: transparent !important` on html/body/#root — ensures the transparent window background shines through
- `-webkit-user-select: none; user-select: none;` — prevents text selection in the frameless window
- `overflow: hidden` — no scrollbars on root

---

## 5. Known Quirks & Technical Debt

### Performance Bottlenecks
1. **No debounced auto-save for note content.** The 1-Click editable note content (`textarea`) updates local state on every keystroke but does not persist to SQLite. The title does, which means every character change triggers a SQL UPDATE + `fetchNotes()` re-fetch. This could cause noticeable lag on slower databases or with many notes.
2. **Re-fetch everything pattern.** Every mutation (add task, toggle task, delete task, etc.) re-fetches entire arrays (tasks, notes, tags, calendarDates) from SQLite rather than applying local mutations. This produces 2–5 SQL SELECT queries per action. For a local SQLite database this is fast, but it's architecturally wasteful.
3. **`process.env` polyfill hack.** The `window.process = { env: {} }` in `index.html` and `define: { "process.env": "{}" }` in `vite.config.ts` exist solely because `react-draggable` (a dependency of `react-rnd`) references `process.env.NODE_ENV` at runtime. This is fragile and could break if react-draggable changes its bundling.

### Fragile Logic
4. **Note content editing is client-side only.** The content `<textarea>` updates `contentValue` local state but never writes back to SQLite. On widget unmount/remount, the content reverts to whatever is in the database. This is effectively read-only for note body text.
5. **`numericId()` / `numericNoteId()` string parsing.** Task IDs are stored as `"t1"`, note IDs as `"n1"` in the frontend, but the database uses integer auto-increment. Every operation destructures `parseInt(id.replace("t", ""), 10)`. If any ID format changes, this breaks everywhere.
6. **Calendar popover uses direct SQL call.** The `fetchTaskTitlesByDate` function is called directly from CalendarWidget rather than through the Zustand store, bypassing the state management layer.
7. **`linkNoteToTagName` removes all existing links before reassigning.** In `linkNoteToTag()`, the first step is `DELETE FROM Note_Task_Tags WHERE Note_ID = ?1`, which nukes all existing links for that note before re-linking to the newly selected tag. This means a note can only be linked to ONE tag (category) at a time, despite the UI suggesting multi-select via pill toggles.

### Missing Features / Known Gaps
8. **No system tray.** The PRD specifies right-click → Quit via system tray, but this is not implemented.
9. **`tsc` does not work from command line** in this environment (prints help page on Windows). TypeScript checking is only verified through the Vite build, which runs `tsc` as part of `npm run build`.
10. **Date-popover x/y coordinates** (`DateTaskPopup` type has `x: number; y: number`) are declared in the type but never used — the popover is always positioned via CSS `inset-x-2 bottom-12`.
11. **No loading state for individual mutations.** The Zustand store has a generic `loading` boolean used only during initial `loadData()`. Individual operations (add/delete/edit) have no loading indicators, so the user might not see immediate feedback on slower operations.

### Build & Environment Notes
- Tailwind CSS v4 uses `@import "tailwindcss"` (no `tailwind.config.js` needed)
- `@tailwindcss/vite` plugin has a type mismatch — cast with `as any` in vite.config.ts
- Vite 7 + React 19 — no compatibility issues observed
- `framer-motion` v12.40.0 installed with 3 sub-packages
- Final build output: 400 KB JS (gzipped 124 KB), 29 KB CSS (gzipped 5 KB), 0.63 KB HTML