/** Default Ghost-Mode hotkey; must match the default registered in lib.rs. */
export const DEFAULT_GHOST_SHORTCUT = "Control+Alt+G";
/** Default Quick-Capture hotkey; must match the default registered in lib.rs. */
export const DEFAULT_CAPTURE_SHORTCUT = "Control+Alt+N";
/** Pre-0.3 default, auto-migrated to the new default on boot. */
export const LEGACY_GHOST_SHORTCUT = "Alt+G";

/** "Control+Alt+G" -> "Ctrl + Alt + G" for display. */
export function prettyShortcut(acc: string): string {
  return acc.split("+").map((p) => (p === "Control" ? "Ctrl" : p === "Super" ? "Win" : p)).join(" + ");
}

/**
 * Build a Tauri accelerator from a keydown. Uses `code` (layout-independent,
 * unaffected by Alt/Shift changing `key`). Returns the accelerator, a
 * "modifiers held so far" preview string, or an error message.
 */
export function acceleratorFromEvent(
  e: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">
): { acc?: string; preview: string; error?: string } {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Control");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");
  const preview = mods.length ? prettyShortcut(mods.join("+")) + " + …" : "";
  const c = e.code;
  if (/^(Control|Alt|Shift|Meta)(Left|Right)$/.test(c)) return { preview };
  let main = "";
  let m: RegExpMatchArray | null;
  if ((m = c.match(/^Key([A-Z])$/))) main = m[1];
  else if ((m = c.match(/^Digit(\d)$/))) main = m[1];
  else if (/^F([1-9]|1\d|2[0-4])$/.test(c)) main = c;
  else if (c === "Space") main = "Space";
  if (!main) return { preview, error: "Unsupported key. Use a letter, number, F-key or Space." };
  if (mods.length === 0) return { preview, error: "Add a modifier (Ctrl / Alt / Shift) before the key." };
  return { acc: [...mods, main].join("+"), preview };
}
