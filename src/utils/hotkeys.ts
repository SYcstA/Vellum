import { useEffect, useRef } from "react";

/**
 * The main key as the rebind UI records it: from the physical `code` when
 * present (so Shift+1 is "1", not "!", and AltGr layouts still match), else
 * from `key`.
 */
function pressedKey(e: Pick<KeyboardEvent, "key"> & Partial<Pick<KeyboardEvent, "code">>): string {
  const c = e.code ?? "";
  let m: RegExpMatchArray | null;
  if ((m = c.match(/^Key([A-Z])$/))) return m[1].toLowerCase();
  if ((m = c.match(/^Digit(\d)$/))) return m[1];
  if (/^F([1-9]|1\d|2[0-4])$/.test(c)) return c.toLowerCase();
  if (c === "Space" || e.key === " ") return "space";
  return e.key.toLowerCase();
}

/**
 * Does a keydown match a spec like "Ctrl+N" / "Ctrl+Shift+K"? Modifiers must
 * match exactly (an extra Shift/Alt is not a match); the key is case-insensitive.
 */
export function matchHotkey(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey"> &
    Partial<Pick<KeyboardEvent, "code" | "metaKey">>,
  spec: string
): boolean {
  const parts = spec.toLowerCase().split("+").map((p) => p.trim());
  const key = parts[parts.length - 1];
  // Specs saved by the rebind UI say "Control"; hand-written ones say "Ctrl".
  const mods = new Set(parts.slice(0, -1).map((m) => (m === "control" ? "ctrl" : m)));
  return (
    pressedKey(e) === key &&
    !e.metaKey &&
    e.ctrlKey === mods.has("ctrl") &&
    e.shiftKey === mods.has("shift") &&
    e.altKey === mods.has("alt")
  );
}

type KeyEv = Parameters<typeof matchHotkey>[0];

/**
 * Run the handler whose spec matches the keydown. Returns true when one ran.
 * Combos in `except` are never handled (left to whoever else wants them).
 */
export function runHotkey(e: KeyEv, map: Record<string, () => void>, except: string[] = []): boolean {
  if (except.some((spec) => matchHotkey(e, spec))) return false;
  for (const [spec, fn] of Object.entries(map)) {
    if (matchHotkey(e, spec)) {
      fn();
      return true;
    }
  }
  return false;
}

/** The handlers currently registered by useAppHotkeys (for the editor iframe). */
let activeMap: Record<string, () => void> | null = null;

/** Combos the note editor keeps for itself: Ctrl+F opens TinyMCE's Find & Replace. */
const EDITOR_KEEPS = ["Ctrl+F"];

/**
 * Called from the TinyMCE iframe, whose key presses never reach the window
 * listener. Runs the app hotkey (e.g. New note) and returns true if one ran, so
 * the caller can preventDefault.
 */
export function runAppHotkeyFromEditor(e: KeyEv): boolean {
  return activeMap ? runHotkey(e, activeMap, EDITOR_KEEPS) : false;
}

/**
 * App-wide in-window hotkeys (not global OS shortcuts). Key presses inside the
 * TinyMCE iframe do not reach this window listener; the editor forwards them
 * through runAppHotkeyFromEditor.
 */
export function useAppHotkeys(map: Record<string, () => void>): void {
  const ref = useRef(map);
  ref.current = map;
  activeMap = map;
  useEffect(() => {
    activeMap = ref.current; // re-arm after a StrictMode mount/cleanup/mount cycle
    const onKey = (e: KeyboardEvent) => {
      if (runHotkey(e, ref.current)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      activeMap = null;
    };
  }, []);
}
