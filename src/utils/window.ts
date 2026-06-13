import { useEffect } from "react";
import {
  getCurrentWindow,
  currentMonitor,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";

let _preMaximizeRect: { x: number; y: number; width: number; height: number } | null = null;

export function isFakeMaximized(): boolean {
  return _preMaximizeRect !== null;
}

export async function fakeMaximize(): Promise<void> {
  try {
    const w = getCurrentWindow();
    const monitor = await currentMonitor();
    if (!monitor) return;

    const pos = await w.outerPosition();
    const size = await w.outerSize();
    _preMaximizeRect = { x: pos.x, y: pos.y, width: size.width, height: size.height };

    const a = monitor.workArea;
    await w.setPosition(new PhysicalPosition(a.position.x, a.position.y));
    await w.setSize(new PhysicalSize(a.size.width, a.size.height));
    localStorage.setItem("is_fake_maximized", "true");
  } catch (err) {
    console.error("fakeMaximize failed:", err);
  }
}

export async function restoreWindow(): Promise<void> {
  try {
    if (!_preMaximizeRect) {
      // Still record the user's intent so next launch doesn't auto-maximize.
      localStorage.setItem("is_fake_maximized", "false");
      return;
    }
    const w = getCurrentWindow();
    const r = _preMaximizeRect;
    await w.setPosition(new PhysicalPosition(r.x, r.y));
    await w.setSize(new PhysicalSize(r.width, r.height));
    _preMaximizeRect = null;
    localStorage.setItem("is_fake_maximized", "false");
  } catch (err) {
    console.error("restoreWindow failed:", err);
  }
}

/**
 * Keep the window fully within the current monitor's work area.
 * If ANY edge of the window's outer rect falls outside the monitor's
 * workArea, clamp the position so the entire window is visible.
 */
export async function sanitizeWindowPosition(): Promise<void> {
  try {
    const w = getCurrentWindow();
    const monitor = await currentMonitor();
    if (!monitor) return;

    const [pos, size] = await Promise.all([
      w.outerPosition(),
      w.outerSize(),
    ]);

    const a = monitor.workArea;
    const clampedX = Math.max(a.position.x, Math.min(pos.x, a.position.x + a.size.width - size.width));
    const clampedY = Math.max(a.position.y, Math.min(pos.y, a.position.y + a.size.height - size.height));

    if (clampedX !== pos.x || clampedY !== pos.y) {
      await w.setPosition(new PhysicalPosition(clampedX, clampedY));
    }
  } catch (err) {
    console.error("sanitizeWindowPosition failed:", err);
  }
}

/** Installs move/resize listeners that keep the window strictly bounded. */
export function useWindowBoundaryGuard(): void {
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void sanitizeWindowPosition(), 600);
    };
    const w = getCurrentWindow();
    const unMoved = w.onMoved(schedule);
    const unResized = w.onResized(schedule);
    // No initial-pass sanitize: it raced with tauri-plugin-window-state's restore
    // and could clamp against a half-restored geometry. App.tsx's initApp() is
    // the single source of truth for startup positioning.
    return () => {
      if (debounce) clearTimeout(debounce);
      void unMoved.then((f) => f());
      void unResized.then((f) => f());
    };
  }, []);
}

/**
 * Clamp widget pixel coords so the widget never leaves the viewport.
 */
export function clampWidgetPosition(
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const maxX = Math.max(0, window.innerWidth - width);
  const maxY = Math.max(0, window.innerHeight - height);
  return {
    x: Math.max(0, Math.min(x, maxX)),
    y: Math.max(0, Math.min(y, maxY)),
  };
}

type WidgetRect = { x: number; y: number; width: number; height: number };
type SetWidgetPos = (widget: string, pos: WidgetRect) => void;

/**
 * Snap a widget back into the viewport on mount and on viewport resize. Guards
 * against (a) stale persisted coords that now land off-screen, and (b) the
 * fakeMaximize → restore cycle shrinking the viewport beneath the widget.
 * Mount-only on cold start; live drag/resize clamps happen in onDragStop/onResizeStop.
 */
export function useWidgetBoundaryClamp(
  widget: string,
  pos: WidgetRect | undefined,
  setPos: SetWidgetPos,
): void {
  useEffect(() => {
    if (!pos) return;
    const fix = () => {
      const clamped = clampWidgetPosition(pos.x, pos.y, pos.width, pos.height);
      if (clamped.x !== pos.x || clamped.y !== pos.y) {
        setPos(widget, { x: clamped.x, y: clamped.y, width: pos.width, height: pos.height });
      }
    };
    fix();
    window.addEventListener("resize", fix);
    return () => window.removeEventListener("resize", fix);
    // Depend ONLY on size (and identity) — x/y change on every drag, which would
    // re-fire setPos and cause redundant store writes. Live drag is already
    // clamped in onDragStop, so omitting x/y here is safe.
  }, [widget, pos?.width, pos?.height, setPos]);
}
