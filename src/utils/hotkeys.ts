import { useEffect, useRef } from "react";

/**
 * Does a keydown match a spec like "Ctrl+N" / "Ctrl+Shift+K"? Modifiers must
 * match exactly (an extra Shift/Alt is not a match); the key is case-insensitive.
 */
export function matchHotkey(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey">,
  spec: string
): boolean {
  const parts = spec.toLowerCase().split("+").map((p) => p.trim());
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  return (
    e.key.toLowerCase() === key &&
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
