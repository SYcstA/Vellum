import { useState, useRef, useEffect } from "react";
import { useAppStore } from "../store/useAppStore";
import { glassStyle } from "../utils/glass";
import { ChevronDown, Pencil, X, Plus } from "lucide-react";
import ConfirmModal from "./ConfirmModal";

function CategoryCombobox() {
  const tags = useAppStore((s) => s.tags);
  const activeCategoryFilter = useAppStore((s) => s.activeCategoryFilter);
  const widgetThemeColor = useAppStore((s) => s.widgetThemeColor);
  const widgetOpacity = useAppStore((s) => s.widgetOpacity);
  const setActiveCategoryFilter = useAppStore((s) => s.setActiveCategoryFilter);
  const renameCategoryAction = useAppStore((s) => s.renameCategoryAction);
  const deleteCategoryAction = useAppStore((s) => s.deleteCategoryAction);
  const addCategoryAction = useAppStore((s) => s.addCategoryAction);

  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [editingCat, setEditingCat] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Filter tags based on search
  const filteredTags = search.trim()
    ? tags.filter((t) => t.toLowerCase().includes(search.toLowerCase()))
    : tags;

  const isNewCategory = search.trim() && !tags.some((t) => t.toLowerCase() === search.toLowerCase());

  const handleSelect = (tag: string) => {
    setActiveCategoryFilter(tag === activeCategoryFilter ? "" : tag);
    setIsOpen(false);
    setSearch("");
  };

  const handleCreateNew = async () => {
    if (!search.trim()) return;
    await addCategoryAction(search.trim());
    setActiveCategoryFilter(search.trim());
    setSearch("");
    setIsOpen(false);
  };

  const handleStartRename = (e: React.MouseEvent, tag: string) => {
    e.stopPropagation();
    setEditingCat(tag);
    setEditValue(tag);
    setTimeout(() => editInputRef.current?.focus(), 50);
  };

  const handleRenameBlur = async () => {
    if (editingCat && editValue.trim() && editValue.trim() !== editingCat) {
      await renameCategoryAction(editingCat, editValue.trim());
    }
    setEditingCat(null);
    setEditValue("");
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
    if (e.key === "Escape") setEditingCat(null);
  };

  const handleDeleteClick = (e: React.MouseEvent, tag: string) => {
    e.stopPropagation();
    setConfirmDelete(tag);
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    try {
      await deleteCategoryAction(target);
      setConfirmDelete(null);
    } catch (err) {
      // Keep the modal open on failure so the user has a UI signal that
      // something went wrong. Store's mutate() already rolled back optimistic state.
      console.error("deleteCategoryAction failed (modal stays open):", err);
    }
  };

  const toggleOpen = () => {
    setIsOpen(!isOpen);
    if (!isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setSearch("");
    }
  };

  return (
    <>
      <div ref={containerRef} className="relative">
        {/* Trigger button */}
        <button
          onClick={toggleOpen}
          className="w-full flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/80 outline-none hover:border-white/20 transition-colors cursor-pointer"
          title="Filter by category"
        >
          <span className="flex-1 text-left truncate">
            {activeCategoryFilter || "All Categories"}
          </span>
          <ChevronDown size={13} strokeWidth={2} className="text-white/40" />
        </button>

        {/* Dropdown */}
        {isOpen && (
          <div className="glass-noise absolute top-full left-0 right-0 mt-1 rounded-xl overflow-hidden z-20" style={glassStyle(widgetThemeColor, Math.max(widgetOpacity, 0.9))}>
            {/* Search input */}
            <div className="p-2 border-b border-white/10">
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && isNewCategory) {
                    e.preventDefault();
                    handleCreateNew();
                  }
                }}
                placeholder="Search or create..."
                title="Search or create category"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white/80 placeholder-white/30 outline-none focus:border-indigo-400/60 transition-colors"
              />
            </div>

            {/* Options list */}
            <div className="max-h-48 overflow-y-auto">
              {/* "All Categories" option */}
              <button
                onClick={() => handleSelect("")}
                className={`w-full flex items-center px-3 py-2 text-xs text-left transition-colors ${
                  !activeCategoryFilter
                    ? "text-indigo-300 bg-indigo-500/10"
                    : "text-white/60 hover:bg-white/5"
                }`}
              >
                All Categories
              </button>

              {filteredTags.map((tag) => (
                <div
                  key={tag}
                  className={`group flex items-center gap-1 px-3 py-1.5 transition-colors cursor-pointer ${
                    activeCategoryFilter === tag
                      ? "text-indigo-300 bg-indigo-500/10"
                      : "text-white/60 hover:bg-white/5"
                  }`}
                  onClick={() => handleSelect(tag)}
                >
                  {editingCat === tag ? (
                    <input
                      ref={editInputRef}
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={handleRenameBlur}
                      onKeyDown={handleRenameKeyDown}
                      className="flex-1 bg-white/10 border border-indigo-400/60 rounded px-1.5 py-0.5 text-xs text-white/90 outline-none"
                      placeholder="Rename category"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="flex-1 text-xs truncate">{tag}</span>
                  )}
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => handleStartRename(e, tag)}
                      className="flex items-center text-white/30 hover:text-indigo-400 transition-colors px-1"
                      title="Rename category"
                    >
                      <Pencil size={12} strokeWidth={1.75} />
                    </button>
                    <button
                      onClick={(e) => handleDeleteClick(e, tag)}
                      className="flex items-center text-white/30 hover:text-red-500 transition-colors px-1"
                      title="Delete category"
                    >
                      <X size={13} strokeWidth={2} />
                    </button>
                  </div>
                </div>
              ))}

              {/* Create new option */}
              {isNewCategory && (
                <button
                  onClick={handleCreateNew}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-emerald-300 hover:bg-white/5 transition-colors border-t border-white/10"
                >
                  <Plus size={13} strokeWidth={2} />
                  <span>Press Enter to create "<strong>{search.trim()}</strong>"</span>
                </button>
              )}

              {filteredTags.length === 0 && !isNewCategory && (
                <p className="px-3 py-3 text-xs text-white/30 text-center">No matching categories</p>
              )}
            </div>
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirmDelete !== null}
        title="Delete Category"
        message={`Deleting "${confirmDelete}" will permanently delete ALL tasks inside it. This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}

export default CategoryCombobox;