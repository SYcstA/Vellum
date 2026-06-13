import { useState, useRef, useEffect, useCallback } from "react";
import { Rnd } from "react-rnd";
import { useAppStore } from "../store/useAppStore";
import { glassStyle } from "../utils/glass";
import { clampWidgetPosition, useWidgetBoundaryClamp } from "../utils/window";
import { Check, X } from "lucide-react";
import ConfirmModal from "./ConfirmModal";

function NotesWidget() {
  const notes = useAppStore((s) => s.notes);
  const tags = useAppStore((s) => s.tags);
  const noteTaskLinks = useAppStore((s) => s.noteTaskLinks);
  const highlightedNoteId = useAppStore((s) => s.highlightedNoteId);
  const noteSelectionEpoch = useAppStore((s) => s.noteSelectionEpoch);
  const editNoteTitle = useAppStore((s) => s.editNoteTitle);
  const saveNoteContent = useAppStore((s) => s.saveNoteContent);
  const linkNoteToTagName = useAppStore((s) => s.linkNoteToTagName);
  const setHighlightedNoteId = useAppStore((s) => s.setHighlightedNoteId);
  const unlinkNote = useAppStore((s) => s.unlinkNote);
  const deleteNoteById = useAppStore((s) => s.deleteNoteById);
  const addNote = useAppStore((s) => s.addNote);
  const widgetPos = useAppStore((s) => s.widgetPositions.notes);
  const setWidgetPos = useAppStore((s) => s.setWidgetPosition);
  const widgetThemeColor = useAppStore((s) => s.widgetThemeColor);
  const widgetOpacity = useAppStore((s) => s.widgetOpacity);
  useWidgetBoundaryClamp("notes", widgetPos, setWidgetPos);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [newNoteContent, setNewNoteContent] = useState("");
  const [contentValue, setContentValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<{ noteId: string; noteTitle: string } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const highlightRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const selectedNote = activeNoteId ? notes.find((n) => n.id === activeNoteId) : undefined;

  function numericNoteId(id: string): number {
    return parseInt(id.replace("n", ""), 10);
  }

  useEffect(() => {
    if (notes.length === 0) return;
    if (highlightedNoteId) {
      const exists = notes.some((n) => n.id === highlightedNoteId);
      if (exists) { setActiveNoteId(highlightedNoteId); return; }
    }
    setActiveNoteId(null);
    // noteSelectionEpoch is included so clicking the SAME linked task again
    // re-opens its note even when highlightedNoteId is unchanged.
  }, [notes, highlightedNoteId, noteSelectionEpoch]);

  useEffect(() => {
    if (highlightedNoteId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightedNoteId, noteSelectionEpoch]);

  useEffect(() => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    if (selectedNote) setContentValue(selectedNote.text);
  }, [selectedNote?.id]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const linkedTagsForNote = (noteId: string): string[] => {
    const taskIds = noteTaskLinks.filter((l) => l.noteId === noteId).map((l) => l.taskId);
    const allTasks = useAppStore.getState().tasks;
    const tagSet = new Set<string>();
    for (const tid of taskIds) { const task = allTasks.find((t) => t.id === tid); if (task) tagSet.add(task.category); }
    return Array.from(tagSet);
  };

  const handleTitleBlur = async () => {
    if (selectedNote && titleValue.trim()) { await editNoteTitle(numericNoteId(selectedNote.id), titleValue.trim()); }
    setEditingTitle(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
    if (e.key === "Escape") setEditingTitle(false);
  };

  const handleContentChange = useCallback((value: string) => {
    setContentValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (selectedNote) {
      debounceRef.current = setTimeout(() => saveNoteContent(numericNoteId(selectedNote.id), value), 600);
    }
  }, [selectedNote, saveNoteContent]);

  const handleTagToggle = async (tagName: string) => {
    if (!selectedNote) return;
    const linked = linkedTagsForNote(selectedNote.id);
    if (linked.includes(tagName)) {
      const taskIds = noteTaskLinks.filter((l) => l.noteId === selectedNote.id).map((l) => l.taskId);
      const allTasks = useAppStore.getState().tasks;
      for (const tid of taskIds) { const task = allTasks.find((t) => t.id === tid); if (task && task.category === tagName) await unlinkNote(selectedNote.id, tid); }
    } else {
      await linkNoteToTagName(selectedNote.id, tagName);
    }
  };

  const handleAddNote = async () => {
    const title = newNoteTitle.trim() || "Untitled";
    const content = newNoteContent.trim() || "New note content...";
    await addNote(title, content);
    setNewNoteTitle(""); setNewNoteContent(""); setAddingNote(false);
  };

  const isLight = widgetThemeColor === "light";

  const tw = (light: string, dark: string) => isLight ? light : dark;
  const txtBody = tw("text-gray-900", "text-white");
  const txtBody2 = tw("text-gray-700", "text-white/80");
  const txtBody3 = tw("text-gray-500", "text-white/60");
  const txtMuted = tw("text-gray-400", "text-white/30");

  return (
    <>
      <Rnd
        position={{ x: widgetPos?.x ?? 900, y: widgetPos?.y ?? 50 }}
        size={{ width: widgetPos?.width ?? 480, height: widgetPos?.height ?? 400 }}
        minWidth={380} minHeight={280}
        bounds="window"
        dragHandleClassName="drag-header"
        enableResizing={{ top: true, right: true, bottom: true, left: true, topRight: true, bottomRight: true, bottomLeft: true, topLeft: true }}
        onDragStop={(_e: any, d: { x: number; y: number }) => {
          const w = widgetPos?.width ?? 480;
          const h = widgetPos?.height ?? 400;
          const clamped = clampWidgetPosition(d.x, d.y, w, h);
          setWidgetPos("notes", { x: clamped.x, y: clamped.y, width: w, height: h });
        }}
        onResizeStop={(_e: any, _dir: any, ref: any, _delta: any, position: { x: number; y: number }) => {
          const w = parseInt(ref.style.width, 10);
          const h = parseInt(ref.style.height, 10);
          const c = clampWidgetPosition(position.x, position.y, w, h);
          setWidgetPos("notes", { x: c.x, y: c.y, width: w, height: h });
        }}
      >
        <div className="relative glass-noise w-full h-full rounded-2xl overflow-hidden flex flex-col" style={glassStyle(widgetThemeColor, widgetOpacity)}>
          <div className={`drag-header flex items-center justify-between px-4 py-3 bg-transparent border-b ${tw("border-black/5", "border-white/8")} select-none cursor-move`}>
            <span className={`text-[13px] font-semibold tracking-tight ${txtBody}`}>Notes</span>
          </div>
          <div className="flex-1 flex overflow-hidden">
            <div className={`w-35 shrink-0 border-r ${tw("border-gray-200", "border-white/10")} overflow-y-auto p-2 space-y-1`}>
              <button onClick={() => setAddingNote(true)} className={`w-full text-xs font-medium ${tw("text-indigo-600 bg-indigo-100/30", "text-indigo-300 bg-indigo-500/20")} hover:bg-indigo-500/30 transition-colors px-2 py-1.5 rounded-lg mb-2`}>
                + New Note
              </button>
              {notes.length === 0 && <p className={`${txtMuted} text-xs text-center pt-2`}>No notes.</p>}
              {notes.map((note) => {
                const isSelected = note.id === activeNoteId;
                const isHighlighted = highlightedNoteId === note.id;
                return (
                  <div key={note.id} ref={isHighlighted ? highlightRef : undefined} onClick={() => { setActiveNoteId(note.id); setHighlightedNoteId(note.id); }}
                    className={`group flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer transition-all text-xs leading-relaxed ${isSelected ? "bg-indigo-500/20 text-indigo-600" : `${txtBody2} hover:bg-white/5`} ${isHighlighted ? "ring-1 ring-indigo-400/40" : ""}`}
                  >
                    <span className={`flex-1 truncate ${tw("text-gray-800", "text-white/70")}`}>{note.title}</span>
                    <button onClick={(e) => { e.stopPropagation(); setConfirmDelete({ noteId: note.id, noteTitle: note.title }); }}
                      className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-500 flex items-center" title="Delete note"><X size={12} strokeWidth={2} /></button>
                  </div>
                );
              })}
            </div>
            <div className="flex-1 flex flex-col overflow-hidden">
              {addingNote ? (
                <div className="p-3 space-y-2">
                  <input type="text" value={newNoteTitle} onChange={(e) => setNewNoteTitle(e.target.value)} placeholder="Note title" autoFocus
                    className={`w-full bg-transparent ${tw("text-gray-900", "text-white/90")} border ${tw("border-gray-300", "border-white/10")} rounded-lg px-3 py-2 text-sm placeholder-gray-400 outline-none focus:border-indigo-400/60 transition-colors`}
                  />
                  <textarea value={newNoteContent} onChange={(e) => setNewNoteContent(e.target.value)} placeholder="Note content..." rows={5}
                    className={`w-full bg-transparent ${tw("text-gray-900", "text-white/90")} border ${tw("border-gray-300", "border-white/10")} rounded-lg px-3 py-2 text-sm placeholder-gray-400 outline-none focus:border-indigo-400/60 transition-colors resize-none`}
                  />
                  <div className="flex gap-2">
                    <button onClick={handleAddNote} disabled={!newNoteTitle.trim() && !newNoteContent.trim()}
                      className={`flex-1 text-xs font-medium ${tw("text-white bg-indigo-600", "text-white bg-indigo-500/40")} hover:bg-indigo-500/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-3 py-1.5 rounded-lg`}>Save</button>
                    <button onClick={() => { setAddingNote(false); setNewNoteTitle(""); setNewNoteContent(""); }}
                      className={`text-xs ${tw("text-gray-500 hover:text-gray-800", "text-white/50 hover:text-white/80")} transition-colors px-3 py-1.5`}>Cancel</button>
                  </div>
                </div>
              ) : selectedNote ? (
                <>
                  <div className={`px-3 pt-3 pb-1.5 border-b ${tw("border-gray-200", "border-white/5")}`}>
                    {editingTitle ? (
                      <input ref={titleInputRef} type="text" value={titleValue} onChange={(e) => setTitleValue(e.target.value)} onBlur={handleTitleBlur} onKeyDown={handleTitleKeyDown}
                        className={`w-full bg-transparent ${tw("text-gray-900", "text-white/90")} border border-indigo-400/60 rounded px-2 py-1 text-sm font-semibold outline-none`} placeholder="Note title"
                      />
                    ) : (
                      <input type="text" value={selectedNote.title} onFocus={() => { setTitleValue(selectedNote.title); setEditingTitle(true); }}
                        onChange={(e) => { setTitleValue(e.target.value); if (e.target.value.trim()) editNoteTitle(numericNoteId(selectedNote.id), e.target.value.trim()); }}
                        className={`w-full bg-transparent px-0 py-1 text-sm font-semibold ${txtBody} outline-none border-none cursor-text`} placeholder="Note title"
                      />
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto p-3">
                    <textarea value={contentValue} onChange={(e) => handleContentChange(e.target.value)}
                      className={`w-full h-full bg-transparent text-sm leading-relaxed ${txtBody2} outline-none border-none resize-none`} placeholder="Note content..."
                    />
                  </div>
                  <div className={`px-3 pb-3 pt-1 border-t ${tw("border-gray-200", "border-white/5")}`}>
                    <details className="group">
                      <summary className={`text-[10px] ${txtBody3} hover:opacity-80 cursor-pointer transition-colors select-none mb-1`}>Link to tags…</summary>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {tags.length === 0 && <span className={`text-[10px] ${txtMuted}`}>No tags yet.</span>}
                        {tags.map((tag) => {
                          const linked = linkedTagsForNote(selectedNote.id).includes(tag);
                          return (
                            <button key={tag} onClick={() => handleTagToggle(tag)}
                              className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${linked ? "bg-indigo-500/30 text-indigo-600 border border-indigo-400/40" : `${tw("bg-transparent text-gray-500", "bg-white/5 text-white/40")} border ${tw("border-gray-300", "border-white/10")} hover:border-white/30`}`}
                            >
                              <span className="inline-flex items-center gap-1">{linked && <Check size={10} strokeWidth={3} />}{tag}</span>
                            </button>
                          );
                        })}
                      </div>
                    </details>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <p className={`${txtMuted} text-sm`}>Select a note from the list</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </Rnd>
      <ConfirmModal
        open={confirmDelete !== null}
        title="Delete Note"
        message={`Are you sure you want to delete: "${confirmDelete?.noteTitle}"?`}
        onConfirm={async () => { if (confirmDelete) { await deleteNoteById(confirmDelete.noteId); setConfirmDelete(null); }}}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}

export default NotesWidget;