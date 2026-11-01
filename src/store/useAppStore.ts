import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import type Database from "@tauri-apps/plugin-sql";
import {
  fetchTasks,
  fetchNotes,
  fetchLogs,
  fetchNoteTaskLinks,
  fetchAllTags,
  createTask,
  toggleTaskCompletion,
  updateTaskTitle,
  updateTaskFull,
  addTaskTag,
  removeTaskTag,
  updateNoteTitle,
  updateNoteContent,
  linkNoteToTask,
  unlinkNoteFromTask,
  linkNoteToTag,
  reorderTasksDb,
  reorderNotesDb,
  renameCategory,
  deleteCategory,
  createCategory,
  deleteTask as deleteTaskDb,
  deleteNote as deleteNoteDb,
  createNote as createNoteDb,
  factoryReset,
  logAction,
  getDb,
} from "./db";
import { stripHtml } from "../utils/notes";
import { DEFAULT_GHOST_SHORTCUT, DEFAULT_CAPTURE_SHORTCUT } from "../utils/shortcut";

export type Task = {
  id: string;
  text: string;
  tags: string[];
  completed: boolean;
  completionDate?: string;
  deadlineDate?: string;
};

export type Note = {
  id: string;
  title: string;
  text: string;
};

export type LogEntry = {
  id: number;
  timestamp: string;
  actionType: string;
  detail: string;
};

export type WidgetPositions = {
  todo?: { x: number; y: number; width: number; height: number };
  calendar?: { x: number; y: number; width: number; height: number };
  notes?: { x: number; y: number; width: number; height: number };
  log?: { x: number; y: number; width: number; height: number };
  settings?: { x: number; y: number; width: number; height: number };
};

interface AppState {
  toggleToDo: () => void;
  toggleCalendar: () => void;
  toggleNotes: () => void;
  toggleLog: () => void;
  toggleSettings: () => void;

  openNotesWithHighlight: (noteId: string) => void;
  /** One-shot request from an app hotkey; NotesWidget consumes it (opens the widget first). */
  pendingNoteAction: "new" | "search" | null;
  requestNoteAction: (action: "new" | "search") => void;
  clearNoteAction: () => void;
  highlightedNoteId: string | null;
  noteSelectionEpoch: number;

  /* Persisted data */
  isToDoOpen: boolean;
  isCalendarOpen: boolean;
  isNotesOpen: boolean;
  isLogOpen: boolean;
  isSettingsOpen: boolean;
  activeCategoryFilter: string;
  activeDateFilter: string;
  widgetPositions: WidgetPositions;
  widgetThemeColor: "dark" | "light" | "pure-black";
  widgetOpacity: number;
  wallpaperPath: string | null;
  ghostShortcut: string;
  captureShortcut: string;
  remindersEnabled: boolean;
  /** Local "HH:mm" at which the daily deadline summary is shown. */
  reminderTime: string;
  setRemindersEnabled: (on: boolean) => void;
  setReminderTime: (time: string) => void;

  /* Non-persisted data */
  tasks: Task[];
  notes: Note[];
  logs: LogEntry[];
  noteTaskLinks: { noteId: string; taskId: string }[];
  tags: string[];
  loading: boolean;
  loaded: boolean;

  /* Actions */
  loadData: () => Promise<void>;
  addTask: (title: string, tags: string[], deadlineDate?: string) => Promise<void>;
  toggleTask: (taskId: number, currentlyCompleted: boolean) => Promise<void>;
  editTaskTitle: (taskId: number, newTitle: string) => Promise<void>;
  editTaskFully: (taskId: number, title: string, tags: string[], deadlineDate?: string) => Promise<void>;
  addTagToTask: (taskId: string, tagName: string) => Promise<void>;
  removeTagFromTask: (taskId: string, tagName: string) => Promise<void>;
  editNoteTitle: (noteId: number, newTitle: string) => Promise<void>;
  saveNoteContent: (noteId: number, content: string) => Promise<void>;
  hideWindow: () => Promise<void>;
  setWidgetPosition: (widget: string, pos: { x: number; y: number; width: number; height: number }) => void;
  setHighlightedNoteId: (noteId: string | null) => void;
  setWidgetThemeColor: (color: "dark" | "light" | "pure-black") => void;
  setWidgetOpacity: (opacity: number) => void;
  setWallpaperPath: (path: string | null) => void;
  setGhostShortcut: (accelerator: string) => void;
  setCaptureShortcut: (accelerator: string) => void;
  refreshLogs: () => Promise<void>;
  refreshTags: () => Promise<void>;
  setActiveCategoryFilter: (filter: string) => void;
  setActiveDateFilter: (date: string) => void;
  renameCategoryAction: (oldName: string, newName: string) => Promise<void>;
  deleteCategoryAction: (name: string) => Promise<void>;
  addCategoryAction: (name: string) => Promise<void>;

  /* Deletion & Creation */
  deleteTaskById: (taskId: string) => Promise<void>;
  deleteNoteById: (noteId: string) => Promise<void>;
  addNote: (title: string, content: string) => Promise<void>;
  resetAllData: () => Promise<void>;

  /* Tagging */
  linkNote: (noteId: string, taskId: string) => Promise<void>;
  unlinkNote: (noteId: string, taskId: string) => Promise<void>;
  linkNoteToTagName: (noteId: string, tagName: string) => Promise<void>;
  refreshNoteTaskLinks: () => Promise<void>;

  /* Reordering (drag & drop) */
  reorderNotes: (orderedIds: string[]) => Promise<void>;
  reorderTasks: (orderedPendingIds: string[]) => Promise<void>;
}

function numericId(id: string): number {
  return parseInt(id.replace("t", ""), 10);
}

/** Local YYYY-MM-DD (matches SQLite date('now','localtime')) to avoid UTC off-by-one near midnight */
function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ─────────────────────────────────────────────────────────────────────────
 * mutate(): the single sanctioned write path for optimistic-UI + SQLite + log.
 *
 * Lifecycle:
 *   1. Snapshot only the slices that may need rollback.
 *   2. Apply the optimistic patch to Zustand.
 *   3. Run the domain write. If it throws, restore the snapshot and rethrow —
 *      SQLite is in autocommit mode, so a thrown statement left the DB unchanged
 *      and the UI rollback matches the DB.
 *   4. Once the write succeeds it is committed; logging is BEST-EFFORT from here
 *      and must never roll back an already-applied mutation.
 *   5. Optional reconcile (e.g. tempId → real id), then refresh the live log.
 *
 * Atomicity caveat: plugin-sql backs SQLite with a multi-connection sqlx pool
 * and executes each statement as a prepared single statement, so a true
 * BEGIN/COMMIT spanning the domain write + log insert is NOT reliably atomic
 * from JS. Genuine atomicity would require a Rust command using pool.begin().
 * For a local single-user app the log insert effectively never fails after a
 * successful write, so safe-ordered best-effort logging is the pragmatic choice.
 * ───────────────────────────────────────────────────────────────────────── */

type StoreSet = (
  partial:
    | Partial<AppState>
    | ((state: AppState) => Partial<AppState>)
) => void;
type StoreGet = () => AppState;

interface MutateConfig<TResult> {
  /** Optimistic patch applied to Zustand BEFORE the DB write. */
  optimistic: (state: AppState) => Partial<AppState>;
  /** Slices to snapshot so exactly these can be restored on failure. */
  rollbackKeys: (keyof AppState)[];
  /** Domain SQL. Receives the shared Database handle; returns a domain result. */
  write: (db: Database) => Promise<TResult>;
  /** Activity-Log entry, written best-effort after a successful write. */
  log?: (result: TResult) => {
    actionType: string;
    detail: string;
    entityType?: "task" | "note" | "category";
    entityId?: number;
  };
  /** Post-write reconciliation, e.g. swap an optimistic tempId for the real id. */
  reconcile?: (state: AppState, result: TResult) => Partial<AppState>;
}

async function mutate<TResult>(
  set: StoreSet,
  get: StoreGet,
  cfg: MutateConfig<TResult>
): Promise<TResult> {
  // 1. Snapshot only the rollback slices.
  const snapshot = Object.fromEntries(
    cfg.rollbackKeys.map((k) => [k, get()[k]])
  ) as Partial<AppState>;

  // 2. Optimistic UI.
  set(cfg.optimistic(get()));

  const db = await getDb();

  // 3. Domain write — rollback the UI only if this throws.
  let result: TResult;
  try {
    result = await cfg.write(db);
  } catch (err) {
    set(snapshot);
    throw err;
  }

  // 4. Best-effort log (never rolls back an applied mutation).
  if (cfg.log) {
    try {
      const { actionType, detail, entityType, entityId } = cfg.log(result);
      await db.execute(
        "INSERT INTO Logs (Action_Type, Detail, Entity_Type, Entity_ID) VALUES (?1, ?2, ?3, ?4)",
        [actionType, detail, entityType ?? null, entityId ?? null]
      );
    } catch (logErr) {
      console.error("mutate: log write failed (mutation already applied):", logErr);
    }
  }

  // 5. Reconcile + refresh the live log.
  if (cfg.reconcile) set(cfg.reconcile(get(), result));
  await get().refreshLogs();
  return result;
}

function numericNoteId(id: string): number {
  return parseInt(id.replace("n", ""), 10);
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      /* ─── PERSISTED STATE ─── */
      isToDoOpen: false,
      isCalendarOpen: false,
      isNotesOpen: false,
      isLogOpen: false,
      isSettingsOpen: false,
      activeCategoryFilter: "",
      activeDateFilter: "",
      widgetThemeColor: "dark" as const,
      widgetOpacity: 1.0,
      wallpaperPath: null,
      ghostShortcut: DEFAULT_GHOST_SHORTCUT,
      captureShortcut: DEFAULT_CAPTURE_SHORTCUT,
      remindersEnabled: false,
      reminderTime: "09:00",
      widgetPositions: {
        todo: { x: 50, y: 50, width: 420, height: 400 },
        calendar: { x: 500, y: 50, width: 360, height: 390 },
        notes: { x: 900, y: 50, width: 480, height: 400 },
        log: { x: 500, y: 470, width: 380, height: 300 },
        settings: { x: 50, y: 480, width: 320, height: 340 },
      },
      setWidgetPosition: (widget: string, pos) =>
        set((s) => ({
          widgetPositions: { ...s.widgetPositions, [widget]: pos },
        })),
      setWidgetThemeColor: (color) => set({ widgetThemeColor: color }),
      setWidgetOpacity: (opacity) => set({ widgetOpacity: opacity }),
      setWallpaperPath: (path) => set({ wallpaperPath: path }),
      setGhostShortcut: (accelerator) => set({ ghostShortcut: accelerator }),
      setCaptureShortcut: (accelerator) => set({ captureShortcut: accelerator }),
      setRemindersEnabled: (on) => set({ remindersEnabled: on }),
      setReminderTime: (time) => set({ reminderTime: time }),
      setHighlightedNoteId: (noteId) => set({ highlightedNoteId: noteId, noteSelectionEpoch: Date.now() }),

      /* ─── NON-PERSISTED STATE ─── */
      highlightedNoteId: null,
      noteSelectionEpoch: 0,
      pendingNoteAction: null,
      requestNoteAction: (action) => set({ isNotesOpen: true, pendingNoteAction: action }),
      clearNoteAction: () => set({ pendingNoteAction: null }),

      toggleToDo: () => set((s) => ({ isToDoOpen: !s.isToDoOpen })),
      toggleCalendar: () => set((s) => ({ isCalendarOpen: !s.isCalendarOpen })),
      toggleNotes: () => set((s) => ({ isNotesOpen: !s.isNotesOpen })),
      toggleLog: () => set((s) => ({ isLogOpen: !s.isLogOpen })),
      toggleSettings: () => set((s) => ({ isSettingsOpen: !s.isSettingsOpen })),

      openNotesWithHighlight: (noteId: string) =>
        set({ isNotesOpen: true, highlightedNoteId: noteId, noteSelectionEpoch: Date.now() }),
      setActiveCategoryFilter: (filter: string) => set({ activeCategoryFilter: filter }),
      // Picking a date in the calendar focuses the To-Do list on that day: open
      // the widget and clear the category filter so the date view isn't empty.
      setActiveDateFilter: (date: string) =>
        set(date ? { activeDateFilter: date, isToDoOpen: true, activeCategoryFilter: "" } : { activeDateFilter: "" }),
      hideWindow: async () => {
        try {
          await invoke("update_tray_text", { text: "Show Dashboard" });
          await getCurrentWindow().hide();
        } catch {}
      },
      tasks: [],
      notes: [],
      logs: [],
      noteTaskLinks: [],
      tags: [],
      loading: false,
      loaded: false,

      loadData: async () => {
        set({ loading: true });
        try {
          const [tasks, notes, noteTaskLinks, tags] = await Promise.all([
            fetchTasks(), fetchNotes(), fetchNoteTaskLinks(), fetchAllTags(),
          ]);
          set({ tasks, notes, noteTaskLinks, tags, loaded: true, loading: false });
        } catch (err) {
          console.error("Failed to load data from SQLite:", err);
          set({ loading: false });
        }
      },

      /* ─── TRUE OPTIMISTIC UI MUTATIONS ─── */

      addTask: async (title, tags, deadlineDate) => {
        const state = get();
        const cleanTags = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)));
        if (cleanTags.length === 0) cleanTags.push("General");
        const maxId = state.tasks.reduce((max, t) => Math.max(max, numericId(t.id)), 0);
        const tempId = `t${maxId + 1}`;
        const mergedTags = Array.from(new Set([...state.tags, ...cleanTags])).sort();
        set({ tasks: [...state.tasks, { id: tempId, text: title, tags: cleanTags, completed: false, deadlineDate: deadlineDate || undefined }], tags: mergedTags });
        try {
          const result = await createTask(title, cleanTags, deadlineDate);
          const realId = `t${result.taskId}`;
          set((s) => ({
            tasks: s.tasks.map((t) => (t.id === tempId ? { ...t, id: realId } : t)),
          }));
          // Auto-link the new task to every note already linked to ANY of its tags,
          // so a note "linked to tag X" stays complete as new tasks join X.
          const cur = get();
          const tagTaskIds = new Set(cur.tasks.filter((t) => t.id !== realId && t.tags.some((tg) => cleanTags.includes(tg))).map((t) => t.id));
          const noteIds = Array.from(new Set(cur.noteTaskLinks.filter((l) => tagTaskIds.has(l.taskId)).map((l) => l.noteId)));
          if (noteIds.length > 0) {
            set((s) => ({ noteTaskLinks: [...s.noteTaskLinks, ...noteIds.map((noteId) => ({ noteId, taskId: realId }))] }));
            for (const noteId of noteIds) {
              try { await linkNoteToTask(numericNoteId(noteId), result.taskId); }
              catch (e) { console.error("Auto-link new task to note failed:", e); set((s) => ({ noteTaskLinks: s.noteTaskLinks.filter((l) => !(l.noteId === noteId && l.taskId === realId)) })); }
            }
          }
        } catch (err) { console.error("Failed to create task, rolling back:", err); set((s) => ({ tasks: s.tasks.filter((t) => t.id !== tempId) })); }
      },

      toggleTask: async (taskId, currentlyCompleted) => {
        const today = localToday();
        set((s) => ({
          tasks: s.tasks.map((t) => {
            const nid = numericId(t.id);
            if (nid === taskId) return { ...t, completed: !currentlyCompleted, completionDate: !currentlyCompleted ? today : undefined };
            return t;
          }),
        }));
        try { await toggleTaskCompletion(taskId, currentlyCompleted); }
        catch (err) { set((s) => ({ tasks: s.tasks.map((t) => { const nid = numericId(t.id); if (nid === taskId) return { ...t, completed: currentlyCompleted, completionDate: currentlyCompleted ? today : undefined }; return t; }) })); }
      },

      editTaskTitle: async (taskId, newTitle) => {
        const prev = get().tasks;
        set((s) => ({ tasks: s.tasks.map((t) => (numericId(t.id) === taskId ? { ...t, text: newTitle } : t)) }));
        try { await updateTaskTitle(taskId, newTitle); } catch (err) { set({ tasks: prev }); }
      },

      editTaskFully: async (taskId, title, tags, deadlineDate) => {
        const cleanTags = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)));
        if (cleanTags.length === 0) cleanTags.push("General");
        // Capture the BEFORE state for the advanced-log delta.
        const prev = get().tasks.find((t) => numericId(t.id) === taskId);
        try {
          await mutate(set, get, {
            optimistic: (s) => ({
              tasks: s.tasks.map((t) =>
                numericId(t.id) === taskId
                  ? { ...t, text: title, tags: cleanTags, deadlineDate: deadlineDate || undefined }
                  : t
              ),
              // Ensure every tag exists in the tags list
              tags: Array.from(new Set([...s.tags, ...cleanTags])).sort(),
            }),
            rollbackKeys: ["tasks", "tags"],
            write: () => updateTaskFull(taskId, title, cleanTags, deadlineDate),
            log: () => {
              // Build delta parts ("·"-separated). First segment = simple view;
              // the rest is surfaced only in the Activity Log's Advanced mode.
              const parts = [`Updated task: "${title}"`];
              if (prev) {
                if (prev.text !== title) parts.push(`renamed from "${prev.text}"`);
                const od = prev.deadlineDate || "none", nd = deadlineDate || "none";
                if (od !== nd) parts.push(`deadline ${od} → ${nd}`);
                const added = cleanTags.filter((t) => !prev.tags.includes(t));
                const removed = prev.tags.filter((t) => !cleanTags.includes(t));
                if (added.length) parts.push(`+tags [${added.join(", ")}]`);
                if (removed.length) parts.push(`−tags [${removed.join(", ")}]`);
              }
              return {
                actionType: "TASK_EDITED",
                detail: parts.join(" · "),
                entityType: "task" as const,
                entityId: taskId,
              };
            },
          });
        } catch (err) {
          // mutate() already rolled back the optimistic UI; swallow to preserve
          // the previous non-throwing contract (the edit modal closes regardless).
          console.error("editTaskFully failed, rolled back:", err);
        }
      },

      addTagToTask: async (taskId, tagName) => {
        const name = tagName.trim();
        if (!name) return;
        const prevTasks = get().tasks;
        const prevTags = get().tags;
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === taskId && !t.tags.includes(name) ? { ...t, tags: [...t.tags, name] } : t)),
          tags: s.tags.includes(name) ? s.tags : [...s.tags, name].sort(),
        }));
        try { await addTaskTag(numericId(taskId), name); await get().refreshLogs(); }
        catch (err) { console.error("addTagToTask failed:", err); set({ tasks: prevTasks, tags: prevTags }); }
      },

      removeTagFromTask: async (taskId, tagName) => {
        const task = get().tasks.find((t) => t.id === taskId);
        if (!task || task.tags.length <= 1 || !task.tags.includes(tagName)) return; // keep >=1 tag
        const prevTasks = get().tasks;
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, tags: t.tags.filter((tg) => tg !== tagName) } : t)) }));
        try { await removeTaskTag(numericId(taskId), tagName); await get().refreshLogs(); }
        catch (err) { console.error("removeTagFromTask failed:", err); set({ tasks: prevTasks }); }
      },

      editNoteTitle: async (noteId, newTitle) => {
        const prev = get().notes;
        set((s) => ({ notes: s.notes.map((n) => (numericNoteId(n.id) === noteId ? { ...n, title: newTitle } : n)) }));
        try { await updateNoteTitle(noteId, newTitle); } catch (err) { set({ notes: prev }); }
      },

      saveNoteContent: async (noteId, content) => {
        const before = get().notes.find((n) => numericNoteId(n.id) === noteId);
        const note = before; // for title in the log
        const prevLen = before ? stripHtml(before.text).length : 0;
        set((s) => ({ notes: s.notes.map((n) => (numericNoteId(n.id) === noteId ? { ...n, text: content } : n)) }));
        try {
          await updateNoteContent(noteId, content);
          // Advanced-log delta: plain-text length change (avoids dumping HTML).
          const newLen = stripHtml(content).length;
          if (note && newLen !== prevLen) {
            const sign = newLen >= prevLen ? "+" : "−";
            await logAction("NOTE_EDITED", `Edited note: "${note.title}" · ${sign}${Math.abs(newLen - prevLen)} chars (${prevLen} → ${newLen})`);
            await get().refreshLogs();
          }
        } catch (err) { console.error("Failed to save note content:", err); }
      },

      deleteTaskById: async (taskId) => {
        const task = get().tasks.find((t) => t.id === taskId);
        const numId = numericId(taskId);
        set((s) => ({ tasks: s.tasks.filter((t) => t.id !== taskId) }));
        try { await deleteTaskDb(numId); if (task) await logAction("TASK_DELETED", `Deleted task: "${task.text}" in [${task.tags.join(", ")}]`); } catch (err) { set((s) => ({ tasks: [...s.tasks, task!].filter(Boolean) })); }
      },

      deleteNoteById: async (noteId) => {
        const note = get().notes.find((n) => n.id === noteId);
        const numId = numericNoteId(noteId);
        set((s) => ({ notes: s.notes.filter((n) => n.id !== noteId), noteTaskLinks: s.noteTaskLinks.filter((l) => l.noteId !== noteId), highlightedNoteId: s.highlightedNoteId === noteId ? null : s.highlightedNoteId }));
        try { await deleteNoteDb(numId); if (note) await logAction("NOTE_DELETED", `Deleted note: "${note.title}"`); } catch (err) { set((s) => ({ notes: [...s.notes, note!].filter(Boolean) })); }
      },

      addNote: async (title, content) => {
        const state = get();
        const maxId = state.notes.reduce((max, n) => Math.max(max, numericNoteId(n.id)), 0);
        const tempId = `n${maxId + 1}`;
        set({ notes: [...state.notes, { id: tempId, title, text: content }] });
        try { const result = await createNoteDb(title, content); set((s) => ({ notes: s.notes.map((n) => (n.id === tempId ? { ...n, id: `n${result.noteId}` } : n)) })); } catch (err) { set((s) => ({ notes: s.notes.filter((n) => n.id !== tempId) })); }
      },

      resetAllData: async () => {
        await factoryReset();
        // True blank slate — wipe every data slice AND any filter state that
        // could still reference vanished categories/dates.
        set({
          tasks: [], notes: [], logs: [], noteTaskLinks: [], tags: [],
          highlightedNoteId: null,
          activeCategoryFilter: "",
          activeDateFilter: "",
        });
      },

      refreshLogs: async () => { const logs = await fetchLogs(); set({ logs }); },
      refreshTags: async () => { const tags = await fetchAllTags(); set({ tags }); },

      linkNote: async (noteId, taskId) => {
        const nid = numericNoteId(noteId); const tid = numericId(taskId);
        set((s) => ({ noteTaskLinks: [...s.noteTaskLinks, { noteId, taskId }] }));
        try { await linkNoteToTask(nid, tid); } catch (err) { set((s) => ({ noteTaskLinks: s.noteTaskLinks.filter((l) => !(l.noteId === noteId && l.taskId === taskId)) })); }
      },

      unlinkNote: async (noteId, taskId) => {
        const nid = numericNoteId(noteId); const tid = numericId(taskId);
        const prev = get().noteTaskLinks;
        set((s) => ({ noteTaskLinks: s.noteTaskLinks.filter((l) => !(l.noteId === noteId && l.taskId === taskId)) }));
        try { await unlinkNoteFromTask(nid, tid); } catch (err) { set({ noteTaskLinks: prev }); }
      },

      linkNoteToTagName: async (noteId, tagName) => {
        const nid = numericNoteId(noteId);
        const state = get();
        const tagTaskIds = state.tasks.filter((t) => t.tags.includes(tagName)).map((t) => t.id);
        const newLinks = tagTaskIds.filter((tid) => !state.noteTaskLinks.some((l) => l.noteId === noteId && l.taskId === tid)).map((tid) => ({ noteId, taskId: tid }));
        if (newLinks.length === 0) return;
        set((s) => ({ noteTaskLinks: [...s.noteTaskLinks, ...newLinks] }));
        try { await linkNoteToTag(nid, tagName); } catch (err) { set((s) => ({ noteTaskLinks: s.noteTaskLinks.filter((l) => !newLinks.some((nl) => nl.noteId === l.noteId && nl.taskId === l.taskId)) })); }
      },

      renameCategoryAction: async (oldName, newName) => {
        const d = await getDb();
        const rows = await d.select<{ ID: number }[]>("SELECT ID FROM Categories WHERE Name = ?1", [oldName]);
        if (rows.length > 0) await renameCategory(rows[0].ID, newName);
        set((s) => ({ tags: s.tags.map((t) => (t === oldName ? newName : t)), tasks: s.tasks.map((t) => (t.tags.includes(oldName) ? { ...t, tags: Array.from(new Set(t.tags.map((tg) => (tg === oldName ? newName : tg)))) } : t)), activeCategoryFilter: s.activeCategoryFilter === oldName ? newName : s.activeCategoryFilter }));
      },

      deleteCategoryAction: async (name) => {
        // Confirmation is owned by the UI (custom ConfirmModal) — no native
        // OS dialog here. This action assumes the caller already confirmed.
        try {
          await mutate(set, get, {
            // Snapshot → optimistic: drop the tag from every task. Tasks left
            // with NO tag are deleted (their note links too); multi-tag tasks
            // survive with the tag stripped. Clear any filter on it.
            optimistic: (s) => {
              const orphanIds = s.tasks.filter((t) => t.tags.includes(name) && t.tags.length === 1).map((t) => t.id);
              return {
                tags: s.tags.filter((t) => t !== name),
                tasks: s.tasks
                  .filter((t) => !orphanIds.includes(t.id))
                  .map((t) => (t.tags.includes(name) ? { ...t, tags: t.tags.filter((tg) => tg !== name) } : t)),
                noteTaskLinks: s.noteTaskLinks.filter((l) => !orphanIds.includes(l.taskId)),
                activeCategoryFilter: s.activeCategoryFilter === name ? "" : s.activeCategoryFilter,
              };
            },
            rollbackKeys: ["tags", "tasks", "noteTaskLinks", "activeCategoryFilter"],
            write: async (db): Promise<number | null> => {
              const rows = await db.select<{ ID: number }[]>(
                "SELECT ID FROM Categories WHERE Name = ?1",
                [name]
              );
              const catId = rows.length > 0 ? rows[0].ID : null;
              if (catId != null) {
                // Repoint primary (Category_ID) off this tag for any multi-tag task
                // BEFORE delete, so FK CASCADE only removes truly tag-less tasks.
                await db.execute(
                  `UPDATE Tasks SET Category_ID = (
                     SELECT TT.Tag_ID FROM Task_Tags TT
                      WHERE TT.Task_ID = Tasks.ID AND TT.Tag_ID != ?1
                      ORDER BY TT.Tag_ID LIMIT 1)
                   WHERE Category_ID = ?1
                     AND EXISTS (SELECT 1 FROM Task_Tags TT2 WHERE TT2.Task_ID = Tasks.ID AND TT2.Tag_ID != ?1)`,
                  [catId]
                );
                await deleteCategory(catId);
              }
              return catId;
            },
            log: (catId) => ({
              actionType: "CATEGORY_DELETED",
              detail: `Deleted tag: "${name}" (tag-less tasks removed)`,
              entityType: "category" as const,
              entityId: catId ?? undefined,
            }),
          });
        } catch (err) {
          // mutate() already restored the snapshot. Re-throw so the calling
          // UI (ConfirmModal) can keep itself open and signal failure.
          console.error("deleteCategoryAction failed, rolled back:", err);
          throw err;
        }
      },

      addCategoryAction: async (name) => { await createCategory(name); const state = get(); if (!state.tags.includes(name)) set({ tags: [...state.tags, name].sort() }); },

      refreshNoteTaskLinks: async () => { const noteTaskLinks = await fetchNoteTaskLinks(); set({ noteTaskLinks }); },

      reorderNotes: async (orderedIds) => {
        const prev = get().notes;
        const byId = new Map(prev.map((n) => [n.id, n]));
        const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean) as Note[];
        // Guard: keep any note not present in orderedIds (shouldn't happen) at end.
        const extras = prev.filter((n) => !orderedIds.includes(n.id));
        set({ notes: [...reordered, ...extras] });
        try { await reorderNotesDb([...reordered, ...extras].map((n) => numericNoteId(n.id))); }
        catch (err) { console.error("reorderNotes failed:", err); set({ notes: prev }); }
      },

      reorderTasks: async (orderedPendingIds) => {
        const prev = get().tasks;
        const byId = new Map(prev.map((t) => [t.id, t]));
        const newPending = orderedPendingIds.map((id) => byId.get(id)).filter(Boolean) as Task[];
        const rest = prev.filter((t) => !orderedPendingIds.includes(t.id)); // completed + any unlisted
        set({ tasks: [...newPending, ...rest] });
        // Persist Position for the dragged (pending) tasks only; completed keep theirs.
        try { await reorderTasksDb(newPending.map((t) => numericId(t.id))); }
        catch (err) { console.error("reorderTasks failed:", err); set({ tasks: prev }); }
      },
    }),
    {
      name: "productivity-app-storage",
      partialize: (state) => ({
        isToDoOpen: state.isToDoOpen,
        isCalendarOpen: state.isCalendarOpen,
        isNotesOpen: state.isNotesOpen,
        isLogOpen: state.isLogOpen,
        isSettingsOpen: state.isSettingsOpen,
        activeCategoryFilter: state.activeCategoryFilter,
        highlightedNoteId: state.highlightedNoteId,
        widgetPositions: state.widgetPositions,
        widgetThemeColor: state.widgetThemeColor,
        widgetOpacity: state.widgetOpacity,
        wallpaperPath: state.wallpaperPath,
        ghostShortcut: state.ghostShortcut,
        captureShortcut: state.captureShortcut,
        remindersEnabled: state.remindersEnabled,
        reminderTime: state.reminderTime,
      }),
    }
  )
);