/** Autosave for the unsaved "New Note" form, so a crash or closed widget loses nothing. */
const KEY = "vellum_note_draft";

export type NoteDraft = { title: string; content: string };

export function loadDraft(): NoteDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d && typeof d.title === "string" && typeof d.content === "string") {
      return { title: d.title, content: d.content };
    }
  } catch {
    // corrupt or storage unavailable: treat as no draft
  }
  return null;
}

/** A blank draft (no title, no content) is not worth keeping: removes the key. */
export function saveDraft(d: NoteDraft): void {
  try {
    if (d.title.trim() === "" && d.content.trim() === "") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // storage full/unavailable: autosave is best-effort
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
