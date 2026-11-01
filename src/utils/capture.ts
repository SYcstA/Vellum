/** Parse the quick-capture box: plain text = task, "n: text" = note. Null = nothing to save. */
export function parseCapture(input: string): { kind: "task" | "note"; title: string } | null {
  const text = input.trim();
  if (!text) return null;
  const m = /^n:\s*(.*)$/is.exec(text);
  if (m) {
    const title = m[1].trim();
    return title ? { kind: "note", title } : null;
  }
  return { kind: "task", title: text };
}
