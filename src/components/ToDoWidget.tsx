import { useState, useRef, useCallback, useMemo } from "react";
import { Rnd } from "react-rnd";
import { motion } from "framer-motion";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore } from "../store/useAppStore";
import { useLocalToday } from "../utils/date";
import { glassStyle } from "../utils/glass";
import { clampWidgetPosition, useWidgetBoundaryClamp } from "../utils/window";
import { Check, X, Pencil, FileText, ChevronRight } from "lucide-react";
import ConfirmModal from "./ConfirmModal";
import CategoryCombobox from "./CategoryCombobox";
import DatePicker from "./DatePicker";

function ToDoWidget() {
  const tasks = useAppStore((s) => s.tasks);
  const tags = useAppStore((s) => s.tags);
  const noteTaskLinks = useAppStore((s) => s.noteTaskLinks);
  const addTask = useAppStore((s) => s.addTask);
  const toggleTask = useAppStore((s) => s.toggleTask);
  const editTaskTitle = useAppStore((s) => s.editTaskTitle);
  const editTaskFully = useAppStore((s) => s.editTaskFully);
  const openNotesWithHighlight = useAppStore((s) => s.openNotesWithHighlight);
  const deleteTaskById = useAppStore((s) => s.deleteTaskById);
  const activeCategoryFilter = useAppStore((s) => s.activeCategoryFilter);
  const activeDateFilter = useAppStore((s) => s.activeDateFilter);
  const setActiveDateFilter = useAppStore((s) => s.setActiveDateFilter);
  const widgetPos = useAppStore((s) => s.widgetPositions.todo);
  const setWidgetPos = useAppStore((s) => s.setWidgetPosition);
  const widgetThemeColor = useAppStore((s) => s.widgetThemeColor);
  const widgetOpacity = useAppStore((s) => s.widgetOpacity);

  const todayStr = useLocalToday();
  useWidgetBoundaryClamp("todo", widgetPos, setWidgetPos);

  const isLight = widgetThemeColor === "light";
  const tw = (light: string, dark: string) => isLight ? light : dark;

  const txtHeader = tw("text-gray-900", "text-gray-200");
  const txtBody = tw("text-gray-900", "text-white/80");
  const txtMuted = tw("text-gray-400", "text-white/30");

  const [inputTitle, setInputTitle] = useState("");
  const [inputTag, setInputTag] = useState("");
  const [inputDeadline, setInputDeadline] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<{ taskId: string; taskTitle: string } | null>(null);

  /* Full edit modal state */
  const [fullEditTask, setFullEditTask] = useState<{
    taskId: string;
    title: string;
    category: string;
    deadline: string;
  } | null>(null);
  const [fullEditTitle, setFullEditTitle] = useState("");
  const [fullEditCategory, setFullEditCategory] = useState("");
  const [fullEditDeadline, setFullEditDeadline] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const tagDatalistId = "todo-tag-suggestions";

  const handleTagInput = (value: string) => {
    setInputTag(value);
    if (value.trim()) setTagSuggestions(tags.filter((t) => t.toLowerCase().includes(value.toLowerCase())));
    else setTagSuggestions([]);
  };
  const selectTagSuggestion = (tag: string) => { setInputTag(tag); setTagSuggestions([]); };
  const handleSave = useCallback(async () => {
    const title = inputTitle.trim();
    const tag = inputTag.trim() || "General";
    if (!title) return;
    await addTask(title, tag, inputDeadline || undefined);
    setInputTitle(""); setInputTag(""); setInputDeadline(""); setShowAddForm(false); setTagSuggestions([]);
  }, [inputTitle, inputTag, inputDeadline, addTask]);
  const handleToggle = (taskId: string, currentlyCompleted: boolean) => toggleTask(parseInt(taskId.replace("t", ""), 10), currentlyCompleted);
  const handleDoubleClick = (taskId: string, currentText: string) => { setEditingTaskId(taskId); setEditValue(currentText); };
  const handleEditBlur = async () => {
    if (editingTaskId && editValue.trim()) { await editTaskTitle(parseInt(editingTaskId.replace("t", ""), 10), editValue.trim()); }
    setEditingTaskId(null); setEditValue("");
  };
  const handleEditKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setEditingTaskId(null); setEditValue(""); } };
  const handleTaskClick = (taskId: string) => {
    const linkedNoteIds = noteTaskLinks.filter((l) => l.taskId === taskId).map((l) => l.noteId);
    if (linkedNoteIds.length > 0) openNotesWithHighlight(linkedNoteIds[0]);
  };

  /* Full edit handlers */
  const openFullEdit = (task: typeof tasks[0]) => {
    setFullEditTask({ taskId: task.id, title: task.text, category: task.category, deadline: task.deadlineDate || "" });
    setFullEditTitle(task.text);
    setFullEditCategory(task.category);
    setFullEditDeadline(task.deadlineDate || "");
  };

  const saveFullEdit = async () => {
    if (!fullEditTask) return;
    const title = fullEditTitle.trim();
    const cat = fullEditCategory.trim() || "General";
    if (!title) return;
    const numId = parseInt(fullEditTask.taskId.replace("t", ""), 10);
    await editTaskFully(numId, title, cat, fullEditDeadline || undefined);
    setFullEditTask(null);
  };

  const cancelFullEdit = () => {
    setFullEditTask(null);
  };

  // A task matches the active filters when it satisfies BOTH the category filter
  // and the date filter (deadline OR completion falling on the picked date).
  const matchesFilters = (t: typeof tasks[0]) =>
    (!activeCategoryFilter || t.category === activeCategoryFilter) &&
    (!activeDateFilter || t.deadlineDate === activeDateFilter || t.completionDate === activeDateFilter);
  const filteredPending = tasks.filter((t) => !t.completed && matchesFilters(t));
  const filteredCompleted = tasks.filter((t) => t.completed && matchesFilters(t));

  // Flatten pending + (collapsible) completed into one list so it can be
  // virtualized as a single scroll region — keeps the DOM light with 100+ tasks.
  type Row =
    | { kind: "task"; task: typeof tasks[0]; completed: boolean }
    | { kind: "completed-header" };
  const rows = useMemo<Row[]>(() => {
    const r: Row[] = [];
    for (const t of filteredPending) r.push({ kind: "task", task: t, completed: false });
    if (filteredCompleted.length > 0) {
      r.push({ kind: "completed-header" });
      if (completedExpanded) {
        for (const t of filteredCompleted) r.push({ kind: "task", task: t, completed: true });
      }
    }
    return r;
  }, [filteredPending, filteredCompleted, completedExpanded]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64, // refined per-row via measureElement (rows vary in height)
    overscan: 8,
    // Stable identity per row so completing/reordering a task keeps its measured
    // height and any inline-edit state attached to the right element.
    getItemKey: (index) => {
      const row = rows[index];
      return row.kind === "task" ? row.task.id : "completed-header";
    },
  });

  const renderTask = (task: typeof tasks[0], isCompleted: boolean) => {
    const isEditing = editingTaskId === task.id;
    // Overdue = has a deadline, not completed, and the deadline is before today.
    // String compare is valid for zero-padded YYYY-MM-DD. Reactive via todayStr.
    const isOverdue = !!task.deadlineDate && !isCompleted && task.deadlineDate < todayStr;
    const linkedNoteCount = noteTaskLinks.filter((l) => l.taskId === task.id).length;
    return (
      <div key={task.id} className="group flex items-start gap-2 p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
        <button onClick={() => handleToggle(task.id, isCompleted)} className={`mt-0.5 w-4 h-4 rounded-full shrink-0 transition-colors flex items-center justify-center ${isCompleted ? "bg-indigo-500/40 border border-indigo-400" : "border-2 border-white/40 hover:border-indigo-400"}`} title={isCompleted ? "Reopen task" : "Mark as completed"}>
          {isCompleted && <Check size={10} strokeWidth={3} className="text-indigo-200" />}
        </button>
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <input type="text" value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={handleEditBlur} onKeyDown={handleEditKeyDown} autoFocus className="w-full bg-white/10 border border-indigo-400/60 rounded px-2 py-0.5 text-sm text-white/90 outline-none" placeholder="Edit task" />
          ) : (
            <p className={`text-sm leading-relaxed transition-colors cursor-pointer ${isCompleted ? "text-white/40 line-through hover:text-indigo-300/60" : `${txtBody} hover:text-indigo-300`}`}
              onClick={() => handleTaskClick(task.id)} onDoubleClick={() => handleDoubleClick(task.id, task.text)}
              title="Click for linked notes • Double-click to edit">
              {task.text}
            </p>
          )}
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className="text-[10px] font-medium text-indigo-300 bg-indigo-500/20 px-1.5 py-0.5 rounded">{task.category}</span>
            {task.deadlineDate && (
              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${isOverdue ? "text-red-300 bg-red-500/20 font-medium" : "text-amber-300/70 bg-amber-500/10"}`}
                title={isOverdue ? "Overdue" : "Deadline"}
              >
                {task.deadlineDate}{isOverdue ? " · overdue" : ""}
              </span>
            )}
            {task.completionDate && <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-300/70 bg-emerald-500/10 px-1.5 py-0.5 rounded"><Check size={10} strokeWidth={3} /> {task.completionDate}</span>}
            {linkedNoteCount > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); handleTaskClick(task.id); }}
                className="inline-flex items-center gap-1 text-[10px] text-sky-300 bg-sky-500/15 hover:bg-sky-500/30 px-1.5 py-0.5 rounded transition-colors"
                title={`Open linked note${linkedNoteCount > 1 ? "s" : ""} in the Notes widget`}
              >
                <FileText size={11} strokeWidth={1.75} /> {linkedNoteCount === 1 ? "Note" : `${linkedNoteCount} Notes`}
              </button>
            )}
          </div>
        </div>
        {/* Edit (pencil) button */}
        <button onClick={() => openFullEdit(task)} className="mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-white/40 hover:text-sky-400 px-1" title="Edit task details"><Pencil size={13} strokeWidth={1.75} /></button>
        {/* Delete button */}
        <button onClick={() => setConfirmDelete({ taskId: task.id, taskTitle: task.text })} className="mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-white/30 hover:text-red-500 px-1" title="Delete task"><X size={14} strokeWidth={2} /></button>
      </div>
    );
  };

  return (
    <>
      <Rnd position={{ x: widgetPos?.x ?? 50, y: widgetPos?.y ?? 50 }} size={{ width: widgetPos?.width ?? 420, height: widgetPos?.height ?? 400 }}
        minWidth={320} minHeight={280} bounds="window" dragHandleClassName="drag-header"
        enableResizing={{ top: true, right: true, bottom: true, left: true, topRight: true, bottomRight: true, bottomLeft: true, topLeft: true }}
        onDragStop={(_e: any, d: { x: number; y: number }) => {
          const w = widgetPos?.width ?? 420;
          const h = widgetPos?.height ?? 400;
          const clamped = clampWidgetPosition(d.x, d.y, w, h);
          setWidgetPos("todo", { x: clamped.x, y: clamped.y, width: w, height: h });
        }}
        onResizeStop={(_e: any, _dir: any, ref: any, _delta: any, position: { x: number; y: number }) => {
          const w = parseInt(ref.style.width, 10);
          const h = parseInt(ref.style.height, 10);
          const c = clampWidgetPosition(position.x, position.y, w, h);
          setWidgetPos("todo", { x: c.x, y: c.y, width: w, height: h });
        }}
      >
        <div className="relative glass-noise w-full h-full rounded-2xl overflow-hidden flex flex-col" style={glassStyle(widgetThemeColor, widgetOpacity)}>
          <div className={`drag-header flex items-center justify-between px-4 py-3 bg-transparent border-b ${tw("border-black/5", "border-white/8")} select-none cursor-move`}>
            <span className={`text-[13px] font-semibold tracking-tight ${txtHeader}`}>To-Do</span>
            <button onClick={() => setShowAddForm(!showAddForm)} className="text-[11px] font-medium text-indigo-300 hover:text-white transition-colors bg-indigo-500/15 hover:bg-indigo-500/35 px-2.5 py-1 rounded-md">{showAddForm ? "Close" : "New"}</button>
          </div>
          {showAddForm && (
            <div className="px-3 pt-3 pb-2 space-y-2 border-b border-white/5">
              <input ref={inputRef} type="text" value={inputTitle} onChange={(e) => setInputTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }} placeholder="Task title…" autoFocus
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/90 placeholder-white/30 outline-none focus:border-indigo-400/60 transition-colors" />
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input type="text" value={inputTag} onChange={(e) => handleTagInput(e.target.value)} list={tagDatalistId} placeholder="Tag (e.g. Laporan PKL)"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/90 placeholder-white/30 outline-none focus:border-indigo-400/60 transition-colors" />
                  <datalist id={tagDatalistId}>{tags.map((t) => (<option key={t} value={t} />))}</datalist>
                  {tagSuggestions.length > 0 && (
                    <div className="glass-noise absolute top-full left-0 right-0 mt-1 rounded-lg overflow-hidden z-10" style={glassStyle(widgetThemeColor, Math.max(widgetOpacity, 0.9))}>
                      {tagSuggestions.map((t) => (<button key={t} onClick={() => selectTagSuggestion(t)} className="w-full text-left text-xs text-white/70 hover:bg-white/10 px-3 py-1.5 transition-colors">{t}</button>))}
                    </div>
                  )}
                </div>
                <DatePicker value={inputDeadline} onChange={(val) => setInputDeadline(val)} />
              </div>
              <button onClick={handleSave} disabled={!inputTitle.trim()} className="w-full text-xs font-medium text-white bg-indigo-500/40 hover:bg-indigo-500/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-3 py-1.5 rounded-lg">+ Add Task</button>
            </div>
          )}
          <div className="px-3 pt-2.5 pb-2 border-b border-white/5"><CategoryCombobox /></div>
          {activeDateFilter && (
            <div className="px-3 pt-2 pb-2 border-b border-white/5">
              <div className="flex items-center gap-2 text-[11px] text-sky-300 bg-sky-500/15 rounded-lg px-2.5 py-1.5">
                <span className="truncate">Showing tasks for <span className="font-mono">{activeDateFilter}</span></span>
                <button onClick={() => setActiveDateFilter("")} className="ml-auto shrink-0 flex items-center text-sky-300/70 hover:text-sky-100 transition-colors" title="Clear date filter"><X size={13} strokeWidth={2} /></button>
              </div>
            </div>
          )}
          <div ref={parentRef} className="flex-1 overflow-y-auto p-3">
            {rows.length === 0 ? (
              <p className={`${txtMuted} text-sm text-center pt-4`}>{activeDateFilter ? `No tasks for ${activeDateFilter}.` : activeCategoryFilter ? `No tasks in [${activeCategoryFilter}].` : "No tasks yet. Click '+ New' to add one!"}</p>
            ) : (
              <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative", width: "100%" }}>
                {rowVirtualizer.getVirtualItems().map((vi) => {
                  const row = rows[vi.index];
                  return (
                    <div
                      key={vi.key}
                      data-index={vi.index}
                      ref={rowVirtualizer.measureElement}
                      style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vi.start}px)` }}
                    >
                      <div className="pb-1.5">
                        {row.kind === "task" ? (
                          renderTask(row.task, row.completed)
                        ) : (
                          <button onClick={() => setCompletedExpanded(!completedExpanded)} className="flex items-center gap-2 pt-2 pb-1 w-full text-left transition-colors hover:opacity-80">
                            <motion.span animate={{ rotate: completedExpanded ? 90 : 0 }} transition={{ duration: 0.15 }} className="text-white/40 inline-flex"><ChevronRight size={13} strokeWidth={2} /></motion.span>
                            <span className="text-[11px] font-medium text-white/40 uppercase tracking-wider">Completed ({filteredCompleted.length})</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Rnd>

      {/* Full edit modal */}
      {fullEditTask && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={cancelFullEdit}>
          <div
            className="relative glass-noise rounded-2xl p-5 w-[380px] max-w-[90vw]"
            style={glassStyle(widgetThemeColor, Math.max(widgetOpacity, 0.92))}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className={`flex items-center gap-1.5 text-sm font-semibold mb-4 ${txtHeader}`}><Pencil size={14} strokeWidth={1.75} /> Edit Task</h3>
            <div className="space-y-3">
              <input
                type="text"
                value={fullEditTitle}
                onChange={(e) => setFullEditTitle(e.target.value)}
                placeholder="Task title…"
                autoFocus
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/90 placeholder-white/30 outline-none focus:border-indigo-400/60 transition-colors"
              />
              <input
                type="text"
                value={fullEditCategory}
                onChange={(e) => setFullEditCategory(e.target.value)}
                placeholder="Category / Tag…"
                list="edit-tag-suggestions"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/90 placeholder-white/30 outline-none focus:border-indigo-400/60 transition-colors"
              />
              <datalist id="edit-tag-suggestions">
                {tags.map((t) => (<option key={t} value={t} />))}
              </datalist>
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/50">Deadline:</span>
                <DatePicker value={fullEditDeadline} onChange={(val) => setFullEditDeadline(val)} />
                {fullEditDeadline && (
                  <button
                    onClick={() => setFullEditDeadline("")}
                    className="flex items-center text-red-400 hover:text-red-300 transition-colors ml-1"
                    title="Clear deadline"
                  ><X size={13} strokeWidth={2} /></button>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={cancelFullEdit}
                className="text-xs text-white/50 hover:text-white/80 transition-colors px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10"
              >Cancel</button>
              <button
                onClick={saveFullEdit}
                disabled={!fullEditTitle.trim()}
                className="text-xs font-medium text-white bg-indigo-500/50 hover:bg-indigo-500/70 disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-4 py-1.5 rounded-lg"
              >Save</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal open={confirmDelete !== null} title="Delete Task" message={`Are you sure you want to delete: "${confirmDelete?.taskTitle}"?`} onConfirm={async () => { if (confirmDelete) { await deleteTaskById(confirmDelete.taskId); setConfirmDelete(null); }}} onCancel={() => setConfirmDelete(null)} />
    </>
  );
}

export default ToDoWidget;