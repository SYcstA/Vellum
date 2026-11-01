import { useState, useRef, useCallback } from "react";
import { Rnd } from "react-rnd";
import { motion } from "framer-motion";
import { useAppStore } from "../store/useAppStore";
import { useLocalToday } from "../utils/date";
import { glassStyle } from "../utils/glass";
import { clampWidgetPosition, useWidgetBoundaryClamp } from "../utils/window";
import { Check, X, Pencil, FileText, ChevronRight, GripVertical } from "lucide-react";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import { createPortal } from "react-dom";
import ConfirmModal from "./ConfirmModal";
import CategoryCombobox from "./CategoryCombobox";
import DatePicker from "./DatePicker";
import { taskTiming } from "../utils/taskTiming";

function ToDoWidget() {
  const tasks = useAppStore((s) => s.tasks);
  const tags = useAppStore((s) => s.tags);
  const notes = useAppStore((s) => s.notes);
  const noteTaskLinks = useAppStore((s) => s.noteTaskLinks);
  const linkNote = useAppStore((s) => s.linkNote);
  const unlinkNote = useAppStore((s) => s.unlinkNote);
  const addTask = useAppStore((s) => s.addTask);
  const toggleTask = useAppStore((s) => s.toggleTask);
  const editTaskTitle = useAppStore((s) => s.editTaskTitle);
  const editTaskFully = useAppStore((s) => s.editTaskFully);
  const openNotesWithHighlight = useAppStore((s) => s.openNotesWithHighlight);
  const deleteTaskById = useAppStore((s) => s.deleteTaskById);
  const reorderTasks = useAppStore((s) => s.reorderTasks);
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
  const [linkNotesTaskId, setLinkNotesTaskId] = useState<string | null>(null);
  const [noteFilter, setNoteFilter] = useState("");
  const closeLinkNotes = () => { setLinkNotesTaskId(null); setNoteFilter(""); };
  // Task with 2+ linked notes opens this chooser instead of jumping to first note.
  const [viewNotesTaskId, setViewNotesTaskId] = useState<string | null>(null);
  const [taskSearch, setTaskSearch] = useState("");

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
  // Tags entered comma-separated → array (trimmed, de-duped, non-empty).
  const parseTags = (raw: string) => Array.from(new Set(raw.split(",").map((t) => t.trim()).filter(Boolean)));
  const handleSave = useCallback(async () => {
    const title = inputTitle.trim();
    const tags = parseTags(inputTag);
    if (tags.length === 0) tags.push("General");
    if (!title) return;
    await addTask(title, tags, inputDeadline || undefined);
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
    if (linkedNoteIds.length === 1) openNotesWithHighlight(linkedNoteIds[0]);
    else if (linkedNoteIds.length > 1) setViewNotesTaskId(taskId); // chooser
  };

  /* Full edit handlers */
  const openFullEdit = (task: typeof tasks[0]) => {
    setFullEditTask({ taskId: task.id, title: task.text, category: task.tags.join(", "), deadline: task.deadlineDate || "" });
    setFullEditTitle(task.text);
    setFullEditCategory(task.tags.join(", "));
    setFullEditDeadline(task.deadlineDate || "");
  };

  const saveFullEdit = async () => {
    if (!fullEditTask) return;
    const title = fullEditTitle.trim();
    const tags = parseTags(fullEditCategory);
    if (tags.length === 0) tags.push("General");
    if (!title) return;
    const numId = parseInt(fullEditTask.taskId.replace("t", ""), 10);
    await editTaskFully(numId, title, tags, fullEditDeadline || undefined);
    setFullEditTask(null);
  };

  const cancelFullEdit = () => {
    setFullEditTask(null);
  };

  // A task matches the active filters when it satisfies BOTH the category filter
  // and the date filter (deadline OR completion falling on the picked date).
  const taskQuery = taskSearch.trim().toLowerCase();
  const matchesFilters = (t: typeof tasks[0]) =>
    (!activeCategoryFilter || t.tags.includes(activeCategoryFilter)) &&
    (!activeDateFilter || t.deadlineDate === activeDateFilter || t.completionDate === activeDateFilter) &&
    (!taskQuery || t.text.toLowerCase().includes(taskQuery) || t.tags.some((tg) => tg.toLowerCase().includes(taskQuery)));
  const filteredPending = tasks.filter((t) => !t.completed && matchesFilters(t));
  const filteredCompleted = tasks.filter((t) => t.completed && matchesFilters(t));

  // Drag-reorder is only valid on the natural pending order (no active filter/
  // search reshuffling the list). Disable the grip when a filter is on.
  const canReorderTasks = !activeCategoryFilter && !activeDateFilter && !taskQuery && filteredPending.length > 1;

  const onTasksDragEnd = (result: DropResult) => {
    if (!result.destination || result.destination.index === result.source.index) return;
    const ids = filteredPending.map((t) => t.id);
    const [moved] = ids.splice(result.source.index, 1);
    ids.splice(result.destination.index, 0, moved);
    reorderTasks(ids);
  };

  const renderTask = (
    task: typeof tasks[0],
    isCompleted: boolean,
    drag?: { dragRef?: (el: HTMLElement | null) => void; dragProps?: object; handleProps?: object | null; isDragging?: boolean }
  ) => {
    const isEditing = editingTaskId === task.id;
    // Reactive via todayStr. `isCompleted` is the list the row sits in.
    const timing = taskTiming({ ...task, completed: isCompleted }, todayStr);
    const isOverdue = timing === "overdue";
    const completedLate = timing === "done-late";
    const linkedNoteCount = noteTaskLinks.filter((l) => l.taskId === task.id).length;
    return (
      <div key={task.id} ref={drag?.dragRef} {...(drag?.dragProps || {})} className={`group flex items-start gap-2 p-2 rounded-lg transition-colors ${drag?.isDragging ? "bg-zinc-800 shadow-xl ring-1 ring-indigo-400/40" : "bg-white/5 hover:bg-white/10"}`}>
        {drag?.handleProps !== undefined && (
          <button {...(drag?.handleProps || {})} className="mt-0.5 shrink-0 cursor-grab active:cursor-grabbing text-white/20 hover:text-white/50 opacity-0 group-hover:opacity-100 transition-opacity" title="Drag to reorder"><GripVertical size={13} strokeWidth={1.75} /></button>
        )}
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
            {task.tags.map((tag) => (
              <span key={tag} className="text-[10px] font-medium text-indigo-300 bg-indigo-500/20 px-1.5 py-0.5 rounded">{tag}</span>
            ))}
            {task.deadlineDate && (
              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${isOverdue ? "text-red-300 bg-red-500/20 font-medium" : "text-amber-300/70 bg-amber-500/10"}`}
                title={isOverdue ? "Overdue" : "Deadline"}
              >
                {task.deadlineDate}{isOverdue ? " · overdue" : ""}
              </span>
            )}
            {task.completionDate && <span className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded ${completedLate ? "text-orange-300 bg-orange-500/20 font-medium" : "text-emerald-300/70 bg-emerald-500/10"}`} title={completedLate ? "Completed late" : "Completed on time"}><Check size={10} strokeWidth={3} /> {task.completionDate}{completedLate ? " · late" : ""}</span>}
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
        {/* Link notes button */}
        <button onClick={() => setLinkNotesTaskId(task.id)} className="mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-white/40 hover:text-sky-400 px-1" title="Link notes"><FileText size={13} strokeWidth={1.75} /></button>
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
                  <input type="text" value={inputTag} onChange={(e) => handleTagInput(e.target.value)} list={tagDatalistId} placeholder="Tags (comma-separated, e.g. PKL, Urgent)"
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
          <div className="px-3 pt-2.5 pb-2 border-b border-white/5 space-y-2">
            <CategoryCombobox />
            <input type="text" value={taskSearch} onChange={(e) => setTaskSearch(e.target.value)} placeholder="Search tasks…"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/90 placeholder-white/30 outline-none focus:border-indigo-400/60 transition-colors" />
          </div>
          {activeDateFilter && (
            <div className="px-3 pt-2 pb-2 border-b border-white/5">
              <div className="flex items-center gap-2 text-[11px] text-sky-300 bg-sky-500/15 rounded-lg px-2.5 py-1.5">
                <span className="truncate">Showing tasks for <span className="font-mono">{activeDateFilter}</span></span>
                <button onClick={() => setActiveDateFilter("")} className="ml-auto shrink-0 flex items-center text-sky-300/70 hover:text-sky-100 transition-colors" title="Clear date filter"><X size={13} strokeWidth={2} /></button>
              </div>
            </div>
          )}
          <div ref={parentRef} className="flex-1 overflow-y-auto p-3">
            {filteredPending.length === 0 && filteredCompleted.length === 0 ? (
              <p className={`${txtMuted} text-sm text-center pt-4`}>{taskQuery ? `No tasks match "${taskSearch}".` : activeDateFilter ? `No tasks for ${activeDateFilter}.` : activeCategoryFilter ? `No tasks in [${activeCategoryFilter}].` : "No tasks yet. Click '+ New' to add one!"}</p>
            ) : (
              <>
                {/* Pending: drag-reorder when no filter active; otherwise static. */}
                <DragDropContext onDragEnd={onTasksDragEnd}>
                  <Droppable droppableId="pending-tasks" isDropDisabled={!canReorderTasks}>
                    {(dp) => (
                      <div ref={dp.innerRef} {...dp.droppableProps} className="space-y-1.5">
                        {filteredPending.map((task, idx) => (
                          <Draggable key={task.id} draggableId={task.id} index={idx} isDragDisabled={!canReorderTasks}>
                            {(drag, snapshot) => {
                              const node = renderTask(task, false, { dragRef: drag.innerRef, dragProps: drag.draggableProps, handleProps: canReorderTasks ? drag.dragHandleProps : undefined, isDragging: snapshot.isDragging });
                              // Portal the dragging clone to <body>: Rnd wraps widgets in a
                              // CSS transform, which otherwise offsets the fixed-position
                              // drag clone (flies right / vanishes).
                              return snapshot.isDragging ? createPortal(node, document.body) : node;
                            }}
                          </Draggable>
                        ))}
                        {dp.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>

                {/* Completed: collapsible, never draggable. */}
                {filteredCompleted.length > 0 && (
                  <div className="mt-1.5">
                    <button onClick={() => setCompletedExpanded(!completedExpanded)} className="flex items-center gap-2 pt-2 pb-1 w-full text-left transition-colors hover:opacity-80">
                      <motion.span animate={{ rotate: completedExpanded ? 90 : 0 }} transition={{ duration: 0.15 }} className="text-white/40 inline-flex"><ChevronRight size={13} strokeWidth={2} /></motion.span>
                      <span className="text-[11px] font-medium text-white/40 uppercase tracking-wider">Completed ({filteredCompleted.length})</span>
                    </button>
                    {completedExpanded && (
                      <div className="space-y-1.5">
                        {filteredCompleted.map((task) => renderTask(task, true))}
                      </div>
                    )}
                  </div>
                )}
              </>
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
                placeholder="Tags (comma-separated)…"
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

      {/* Link-notes modal: toggle which notes connect to this task (Note_Task_Tags). */}
      {linkNotesTaskId && (() => {
        const linkedSet = new Set(noteTaskLinks.filter((l) => l.taskId === linkNotesTaskId).map((l) => l.noteId));
        const filtered = notes.filter((n) => n.title.toLowerCase().includes(noteFilter.toLowerCase()));
        const allLinked = filtered.length > 0 && filtered.every((n) => linkedSet.has(n.id));
        const toggleAll = async () => {
          for (const n of filtered) {
            const isLinked = linkedSet.has(n.id);
            if (allLinked && isLinked) await unlinkNote(n.id, linkNotesTaskId);
            else if (!allLinked && !isLinked) await linkNote(n.id, linkNotesTaskId);
          }
        };
        return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={closeLinkNotes}>
          <div className="relative glass-noise rounded-2xl p-5 w-[380px] max-w-[90vw]" style={glassStyle(widgetThemeColor, Math.max(widgetOpacity, 0.92))} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className={`flex items-center gap-1.5 text-sm font-semibold ${txtHeader}`}><FileText size={14} strokeWidth={1.75} /> Link Notes</h3>
              <span className="text-[10px] text-white/40">{linkedSet.size} linked</span>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <input type="text" value={noteFilter} onChange={(e) => setNoteFilter(e.target.value)} placeholder="Search notes…" autoFocus
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/90 placeholder-white/30 outline-none focus:border-indigo-400/60 transition-colors" />
              {filtered.length > 0 && (
                <button onClick={toggleAll} className="shrink-0 text-[10px] font-medium text-indigo-300 bg-indigo-500/15 hover:bg-indigo-500/35 px-2.5 py-1.5 rounded-lg transition-colors">{allLinked ? "Unlink all" : "Link all"}</button>
              )}
            </div>
            <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
              {notes.length === 0 && <p className={`${txtMuted} text-xs text-center py-2`}>No notes yet.</p>}
              {notes.length > 0 && filtered.length === 0 && <p className={`${txtMuted} text-xs text-center py-2`}>No notes match "{noteFilter}".</p>}
              {filtered.map((note) => {
                const linked = linkedSet.has(note.id);
                return (
                  <button key={note.id} onClick={() => linked ? unlinkNote(note.id, linkNotesTaskId) : linkNote(note.id, linkNotesTaskId)}
                    className={`w-full flex items-center gap-2 text-left text-xs px-3 py-2 rounded-lg transition-colors ${linked ? "bg-indigo-500/30 text-indigo-200 border border-indigo-400/40" : "bg-white/5 text-white/70 border border-white/10 hover:bg-white/10"}`}>
                    <span className={`w-4 h-4 rounded shrink-0 flex items-center justify-center ${linked ? "bg-indigo-500/50" : "border border-white/30"}`}>{linked && <Check size={10} strokeWidth={3} className="text-white" />}</span>
                    <span className="flex-1 truncate">{note.title}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end mt-5">
              <button onClick={closeLinkNotes} className="text-xs font-medium text-white bg-indigo-500/50 hover:bg-indigo-500/70 transition-colors px-4 py-1.5 rounded-lg">Done</button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* View-notes chooser: task with 2+ linked notes picks which one to open. */}
      {viewNotesTaskId && (() => {
        const linkedIds = new Set(noteTaskLinks.filter((l) => l.taskId === viewNotesTaskId).map((l) => l.noteId));
        const linkedNotes = notes.filter((n) => linkedIds.has(n.id));
        const open = (noteId: string) => { openNotesWithHighlight(noteId); setViewNotesTaskId(null); };
        return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setViewNotesTaskId(null)}>
          <div className="relative glass-noise rounded-2xl p-5 w-[380px] max-w-[90vw]" style={glassStyle(widgetThemeColor, Math.max(widgetOpacity, 0.92))} onClick={(e) => e.stopPropagation()}>
            <h3 className={`flex items-center gap-1.5 text-sm font-semibold mb-4 ${txtHeader}`}><FileText size={14} strokeWidth={1.75} /> Open Linked Note</h3>
            <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
              {linkedNotes.map((note) => (
                <button key={note.id} onClick={() => open(note.id)}
                  className="w-full flex items-center gap-2 text-left text-xs px-3 py-2 rounded-lg bg-white/5 text-white/70 border border-white/10 hover:bg-sky-500/20 hover:text-sky-200 hover:border-sky-400/40 transition-colors">
                  <FileText size={12} strokeWidth={1.75} className="shrink-0 text-sky-300" />
                  <span className="flex-1 truncate">{note.title}</span>
                  <ChevronRight size={13} strokeWidth={2} className="shrink-0 opacity-50" />
                </button>
              ))}
            </div>
            <div className="flex justify-end mt-5">
              <button onClick={() => setViewNotesTaskId(null)} className="text-xs text-white/50 hover:text-white/80 transition-colors px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10">Cancel</button>
            </div>
          </div>
        </div>
        );
      })()}
    </>
  );
}

export default ToDoWidget;