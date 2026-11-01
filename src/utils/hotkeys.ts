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

/**
 * App-wide in-window hotkeys (not global OS shortcuts). Key presses inside the
 * TinyMCE iframe never reach this window listener, so they are naturally ignored.
 */
export function useAppHotkeys(map: Record<string, () => void>): void {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      for (const [spec, fn] of Object.entries(ref.current)) {
        if (matchHotkey(e, spec)) {
          e.preventDefault();
          fn();
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
