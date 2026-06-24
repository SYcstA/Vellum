# State of the Union — Vellum v0.2.0

> Last updated: 2026-06-24. DB identifier: `com.osvaldo.vellum.dev` (debug).

---

## 1. Tech Stack

### Frontend
| Layer | Library | Version |
|---|---|---|
| UI Framework | React | ^19.1.0 |
| Language | TypeScript | ~5.8.3 |
| Build | Vite | ^7.0.4 |
| Styling | Tailwind CSS | ^4.3.0 |
| State | Zustand | ^5 (persist middleware) |
| Drag & Drop | @hello-pangea/dnd | ^18.0.1 |
| Rich Text | TinyMCE 8.6 (self-hosted) + @tinymce/tinymce-react | ^6.3.0 |
| Widget resize/drag | react-rnd | ^10.5.3 |
| Icons | lucide-react | ^1.18.0 |
| Animation | framer-motion | ^12.40.0 |

### Backend (Tauri 2 / Rust)
| Plugin | Role |
|---|---|
| tauri-plugin-sql | SQLite via async JS bridge |
| tauri-plugin-window-state | Persist window size/position across sessions |
| tauri-plugin-autostart | Launch-on-startup toggle |
| tauri-plugin-dialog | Native file picker (wallpaper) |
| tauri-plugin-global-shortcut | Ghost Mode hotkey (Alt+G default, user-rebindable) |
| tauri-plugin-opener / shell | Open external links |
| tauri-plugin-process | `kill_app` command |

### Data flow
```
React Component
  → Zustand action (optimistic patch applied instantly)
    → mutate() helper (snapshot + rollback keys captured)
      → DB write (tauri-plugin-sql, SQLite WAL mode)
        ↳ on failure → state rolled back to snapshot
  → refreshLogs() / refreshTags() for reactive side-effects
```

`mutate<TResult>({ optimistic, rollbackKeys, write, log?, afterSuccess? })` is the central write helper in `src/store/useAppStore.ts`. All store actions flow through it — replaces the old "refetch everything" pattern.

---

## 2. Database Schema (Exact)

### Tables

```sql
CREATE TABLE IF NOT EXISTS Categories (
  ID   INTEGER PRIMARY KEY AUTOINCREMENT,
  Name TEXT NOT NULL UNIQUE
);

-- Primary tag stored as Category_ID (NOT NULL, always set).
-- Additional tags via Task_Tags pivot.
-- Position col added via guarded ALTER migration.
CREATE TABLE IF NOT EXISTS Tasks (
  ID              INTEGER PRIMARY KEY AUTOINCREMENT,
  Category_ID     INTEGER NOT NULL,
  Title           TEXT NOT NULL,
  Deadline_Date   TEXT,
  Completion_Date TEXT,
  Status          TEXT NOT NULL DEFAULT 'pending',
  -- Position INTEGER (guarded ALTER: ADD COLUMN + UPDATE SET Position=ID WHERE NULL)
  FOREIGN KEY (Category_ID) REFERENCES Categories(ID) ON DELETE CASCADE
);

-- M:N pivot: task can belong to many tags beyond its primary
CREATE TABLE IF NOT EXISTS Task_Tags (
  Task_ID INTEGER NOT NULL,
  Tag_ID  INTEGER NOT NULL,
  PRIMARY KEY (Task_ID, Tag_ID),
  FOREIGN KEY (Task_ID) REFERENCES Tasks(ID)      ON DELETE CASCADE,
  FOREIGN KEY (Tag_ID)  REFERENCES Categories(ID) ON DELETE CASCADE
);

-- Position col added via guarded ALTER migration.
CREATE TABLE IF NOT EXISTS Notes (
  ID      INTEGER PRIMARY KEY AUTOINCREMENT,
  Title   TEXT NOT NULL DEFAULT 'Untitled',
  Content TEXT NOT NULL
  -- Position INTEGER (guarded ALTER)
);

-- M:N pivot: note linked to many tasks, task to many notes
CREATE TABLE IF NOT EXISTS Note_Task_Tags (
  Note_ID INTEGER NOT NULL,
  Task_ID INTEGER NOT NULL,
  PRIMARY KEY (Note_ID, Task_ID),
  FOREIGN KEY (Note_ID) REFERENCES Notes(ID) ON DELETE CASCADE,
  FOREIGN KEY (Task_ID) REFERENCES Tasks(ID) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Logs (
  ID          INTEGER PRIMARY KEY AUTOINCREMENT,
  Timestamp   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  Action_Type TEXT NOT NULL,
  Detail      TEXT NOT NULL
  -- Entity_Type TEXT, Entity_ID INTEGER (guarded ALTERs, reserved for future deep-link)
);
```

### Indexes
```sql
CREATE INDEX IF NOT EXISTS idx_tasktags_task ON Task_Tags(Task_ID);
CREATE INDEX IF NOT EXISTS idx_tasktags_tag  ON Task_Tags(Tag_ID);
CREATE INDEX IF NOT EXISTS idx_ntt_task      ON Note_Task_Tags(Task_ID);
CREATE INDEX IF NOT EXISTS idx_ntt_note      ON Note_Task_Tags(Note_ID);
CREATE INDEX IF NOT EXISTS idx_tasks_cat     ON Tasks(Category_ID);
CREATE INDEX IF NOT EXISTS idx_tasks_comp    ON Tasks(Completion_Date);
CREATE INDEX IF NOT EXISTS idx_tasks_dead    ON Tasks(Deadline_Date);
CREATE INDEX IF NOT EXISTS idx_logs_ts       ON Logs(Timestamp DESC);
```

### Cascade rules
- Delete `Categories` → cascades to `Tasks` (via `Category_ID`) + `Task_Tags` (via `Tag_ID`).
- Delete `Tasks` → cascades to `Task_Tags` + `Note_Task_Tags`.
- Delete `Notes` → cascades to `Note_Task_Tags`.
- `deleteCategoryAction`: before deleting, SQL repoints `Category_ID` for multi-tag tasks to a surviving tag. Only truly tag-less tasks get cascade-deleted.

### Migration strategy
All schema changes are **guarded idempotent**: `ALTER TABLE … ADD COLUMN` wrapped in `try/catch`, silently swallowing the "duplicate column" error. No migration version table. `initSchema()` is safe to call on every boot.

### Exported db.ts functions (v0.2.0)
`getDb`, `initSchema`, `markSeeded`, `fetchTasks`, `fetchNotes`, `fetchNoteTaskLinks`, `fetchTaskTitlesByDate`, `fetchAllTags`, `createTask(title, tags[], deadlineDate?)`, `addTaskTag`, `removeTaskTag`, `updateTaskTitle`, `updateTaskFull(taskId, title, tags[], deadlineDate?)`, `updateNoteTitle`, `updateNoteContent`, `toggleTaskCompletion`, `linkNoteToTask`, `unlinkNoteFromTask`, `linkNoteToTag`, `renameCategory`, `deleteCategory`, `createCategory`, `deleteTask`, `deleteNote`, `createNote`, `fetchLogs`, `factoryReset`, `reorderTasksDb`, `reorderNotesDb`, `logAction`

---

## 3. State Management (Zustand)

### State shape

```typescript
// Persisted (localStorage via zustand/middleware/persist)
isToDoOpen, isCalendarOpen, isNotesOpen, isLogOpen, isSettingsOpen: boolean
widgetPositions: { todo, calendar, notes, log, settings: { x, y, width, height } }
widgetThemeColor: "dark" | "light" | "pure-black"
widgetOpacity: number
wallpaperPath: string | null
ghostShortcut: string   // e.g. "Alt+G", "Control+Shift+K"

// DB-backed (loaded at boot, written via mutate())
tasks: Task[]           // { id, text, tags: string[], completed, completionDate?, deadlineDate? }
notes: Note[]           // { id, title, text }
logs: LogEntry[]        // { id, timestamp, actionType, detail }
noteTaskLinks: { noteId: string; taskId: string }[]
tags: string[]          // all Categories.Name values

// Ephemeral
loading, loaded: boolean
activeCategoryFilter: string
activeDateFilter: string
highlightedNoteId: string | null
noteSelectionEpoch: number
```

### Store actions (v0.2.0)
`loadData`, `addTask(title, tags[], deadlineDate?)`, `toggleTask`, `editTaskTitle`, `editTaskFully(taskId, title, tags[], deadlineDate?)`, `addTagToTask`, `removeTagFromTask`, `editNoteTitle`, `saveNoteContent`, `deleteTaskById`, `deleteNoteById`, `addNote`, `resetAllData`, `refreshLogs`, `refreshTags`, `linkNote`, `unlinkNote`, `linkNoteToTagName`, `renameCategoryAction`, `deleteCategoryAction`, `addCategoryAction`, `refreshNoteTaskLinks`, `reorderNotes`, `reorderTasks`, `setWidgetPosition`, `setWidgetThemeColor`, `setWidgetOpacity`, `setWallpaperPath`, `setGhostShortcut`, `openNotesWithHighlight`, `setActiveCategoryFilter`, `setActiveDateFilter`

### mutate() pattern
```typescript
mutate<TResult>({
  optimistic: (state) => Partial<AppState>,  // applied instantly
  rollbackKeys: (keyof AppState)[],           // snapshotted for rollback
  write: (db) => Promise<TResult>,            // SQL write
  log?: { actionType, detail },               // auto-logged to Logs table
  afterSuccess?: (result, get, set) => void,  // post-commit side effects
})
```
On DB error: state rolled back to snapshot. Replaces the old "refetch everything" pattern.

---

## 4. Widget Architecture

### Component map
| Component | File | Responsibility |
|---|---|---|
| `App` | `src/App.tsx` | Boot: `initSchema` → `markSeeded` → `loadData` → re-apply ghost shortcut |
| `MasterDock` | `src/components/MasterDock.tsx` | Fixed bottom-center: 5 widget toggles |
| `ToDoWidget` | `src/components/ToDoWidget.tsx` | Tasks CRUD, DnD reorder, tag chips, search, overdue/completed-late badges, note-picker modal |
| `CalendarWidget` | `src/components/CalendarWidget.tsx` | Monthly grid, completion/deadline dots, date-click popover |
| `NotesWidget` | `src/components/NotesWidget.tsx` | TinyMCE editor, note list DnD, resizable splitter, search, link-to-tags |
| `LogWidget` | `src/components/LogWidget.tsx` | Activity log, Simple/Advanced toggle |
| `SettingsWidget` | `src/components/SettingsWidget.tsx` | Theme, opacity, wallpaper, autostart, Ghost shortcut capture |
| `WindowControls` | `src/components/WindowControls.tsx` | Ghost/hide/max/quit buttons, reactive shortcut tooltip |

### Rnd configuration
All widgets: `bounds="window"`, `dragHandleClassName="drag-header"`, all 8 resize directions, positions persisted to Zustand `widgetPositions`.

---

## 5. v0.2.0 Feature Details

### TinyMCE Rich Text Notes (`src/components/NotesWidget.tsx`, `src/utils/notes.ts`)
- Editor: `skin="oxide-dark"`, `content_css="dark"`, self-hosted from `/tinymce/`.
- `noteContentToHtml(content)`: if no HTML tags → legacy plain-text path: HTML-escape + `\n`→`<br>`. Otherwise passes through.
- `stripHtml(html)`: strips tags + decodes entities for plain-text search and char-delta logging.
- Dark theme via `src/App.css`: `.tox-edit-area__iframe`, `.tox-editor-header`, toolbar, overflow popup (`.tox-toolbar__overflow`, `.tox-collection`, `.tox-pop__dialog`) — `background: #18181b`, light icon colors.

### Drag & Drop Reorder (`@hello-pangea/dnd`)
- `DragDropContext` → `Droppable` → `Draggable` in both ToDoWidget and NotesWidget.
- **Critical fix:** Both use `createPortal(node, document.body)` when `snapshot.isDragging`. Without this, `react-rnd`'s CSS `transform` on the widget container offsets the `position: fixed` drag clone off-screen.
- **ToDoWidget:** pending list only. `canReorderTasks = !activeCategoryFilter && !activeDateFilter && !taskQuery && filteredPending.length > 1`. `GripVertical` handle hidden when filtered.
- **NotesWidget:** `canReorderNotes = noteQuery === "" && notes.length > 1`.
- **Persistence:** `Position INTEGER` column on `Tasks` + `Notes` (guarded ALTER). `reorderTasksDb` / `reorderNotesDb` UPDATE `Position = index`. Fetch: `ORDER BY Position, ID`.

### Resizable Notes Splitter
- `listWidth` state (default 180px), persisted to `localStorage` key `vellum_notes_list_width`.
- `<div onMouseDown={onSplitDown} className="shrink-0 w-1 cursor-col-resize …">` between list and editor.
- `mousemove` updates `listWidth` clamped 120px–320px; removed on `mouseup`.

### Search & Filter
- **Tasks:** `taskQuery` (trimmed, lowercased) matches `task.text` OR any `task.tags` entry. Combined with `activeCategoryFilter` (tag match) and `activeDateFilter` (deadline date match) in `matchesFilters(task)`.
- **Notes:** `noteQuery` filters by `note.title` OR `stripHtml(note.text)` — handles TinyMCE HTML content.
- Drag grip hidden while any filter/search active (ambiguous reorder semantics).

### Ghost Mode Custom Shortcut
- **Rust** (`src-tauri/src/lib.rs`): `GhostShortcut(Mutex<Option<Shortcut>>)` holds active combo. Handler compares each press against stored value, toggles `set_ignore_cursor_events`. `set_ghost_shortcut(accelerator)` command: `unregister_all()` → register new → update state.
- **Frontend:** `ghostShortcut: string` persisted in Zustand (default `"Alt+G"`). SettingsWidget captures keydown → builds Tauri accelerator string (≥1 modifier required) → `invoke("set_ghost_shortcut")` + `setGhostShortcut(acc)`. WindowControls tooltip reads from store — reactive. App.tsx re-invokes on boot if saved ≠ `"Alt+G"`.

### Bi-directional Note ↔ Task Linking
- `noteTaskLinks: { noteId, taskId }[]` mirrors `Note_Task_Tags`.
- **Task → Note (note-picker):** `handleTaskClick(taskId)` in ToDoWidget: 0 linked notes → no-op; 1 → `openNotesWithHighlight(noteId)` directly; 2+ → note-chooser modal lists all linked notes by title, click → `openNotesWithHighlight`.
- **Note → Tasks:** NotesWidget link-tags panel; `linkNoteToTagName(noteId, tagName)` links to all tasks of that tag.
- `openNotesWithHighlight(noteId)`: sets `highlightedNoteId` + increments `noteSelectionEpoch` (epoch ensures re-fire on same note re-select).

### Activity Log (Governance)
- **Simple mode:** `segments[0]` (summary string only).
- **Advanced mode:** `segments.slice(1)` shown as `<ul>` with left indigo border.
- **Delta logging:** `editTaskFully` snapshots before-state, builds `"Updated task · renamed from X → Y · deadline old → new · +tags [A] · −tags [B]"`. `saveNoteContent` logs `"Edited note «Title» · ±N chars"` (N = `stripHtml` char delta).
- **13 action types** (all colour-mapped): `TASK_CREATED`, `TASK_COMPLETED`, `TASK_REOPENED`, `TASK_EDITED`, `TASK_DELETED`, `NOTE_CREATED`, `NOTE_EDITED`, `NOTE_DELETED`, `NOTE_LINKED`, `CATEGORY_CREATED`, `CATEGORY_RENAMED`, `CATEGORY_DELETED`, `SYSTEM`.

### M:N Tag System
- `Task.tags: string[]` (replaced old single `category: string`).
- `Tasks.Category_ID` = primary tag (always set, NOT NULL).
- Additional tags in `Task_Tags` pivot.
- `fetchTasks()`: JOINs primary as `PC.Name AS Primary_Name`, aggregates rest via `group_concat(char(31))`; JS reassembles `[Primary_Name, ...rest]` (primary-first sort — correlated ORDER BY in subquery rejected by SQLite, fixed in JS).
- `createTask(title, tags[], deadlineDate?)`: first tag = primary; all tags inserted into `Task_Tags`.
- `updateTaskFull(...)`: DELETE + re-INSERT `Task_Tags`.

---

## 6. Rust Backend (`src-tauri/src/lib.rs`)

### App state structs
```rust
struct ToggleMenuItem(Mutex<MenuItem<Wry>>);
struct GhostMenuItem(Mutex<MenuItem<Wry>>);
struct GhostState(Mutex<bool>);
struct GhostShortcut(Mutex<Option<Shortcut>>);  // active rebindable combo
```

### Tauri commands
```rust
fn update_tray_text(app, text: String)
fn kill_app(app)
fn set_ghost_mode(app, enabled: bool)           // set_ignore_cursor_events + emit event + tray
fn set_ghost_shortcut(app, accelerator: String) // unregister_all + register + update GhostShortcut
```

Default hotkey: `Alt+G`. Handler toggles ghost on press; compares against `GhostShortcut` state so rebind takes effect without touching the handler closure.

---

## 7. Key File Map

| File | Role |
|---|---|
| `src/store/db.ts` | SQLite DDL, migrations, all raw query functions |
| `src/store/useAppStore.ts` | Zustand store: state shape, `mutate()` helper, all actions |
| `src/utils/notes.ts` | `noteContentToHtml`, `stripHtml` |
| `src/utils/glass.ts` | `glassStyle(theme, opacity)` inline style generator |
| `src/utils/window.ts` | `clampWidgetPosition`, `useWidgetBoundaryClamp`, `fakeMaximize` |
| `src/components/ToDoWidget.tsx` | Task list, DnD, search, note-picker, overdue badges |
| `src/components/NotesWidget.tsx` | TinyMCE editor, DnD, splitter, search, link panel |
| `src/components/LogWidget.tsx` | Activity log, Simple/Advanced toggle |
| `src/components/SettingsWidget.tsx` | Theme, opacity, wallpaper, autostart, ghost shortcut capture |
| `src/components/WindowControls.tsx` | Ghost/hide/max/quit + reactive tooltip |
| `src/App.tsx` | Boot sequence, widget render, background drag |
| `src/App.css` | TinyMCE dark overrides, global theme tokens |
| `src-tauri/src/lib.rs` | Tauri commands, global shortcut, ghost mode, tray |
| `src-tauri/tauri.conf.json` | App identifier: `com.osvaldo.vellum.dev` |
