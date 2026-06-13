import type { CSSProperties } from "react";

export type WidgetTheme = "dark" | "light" | "pure-black";

/**
 * System-Native Glass surface.
 *
 * Layered translucency + backdrop saturation for a "weighted", premium feel
 * (not flat/plastic): a faint outer hairline, a bright top highlight (light
 * catching the edge), and a deep lifted shadow for mass. Pair the element with
 * the `glass-noise` class (and `relative`) for the subtle grain overlay.
 *
 * Inner children should stay `bg-transparent` so the blur is applied once and
 * never stacks (the cause of the old "muddy glass" look).
 */
export function glassStyle(theme: WidgetTheme, opacity: number): CSSProperties {
  if (theme === "pure-black") {
    // Opaque, OLED-friendly: no blur (nothing to see through), pure mass.
    return {
      backgroundColor: `rgba(9, 9, 11, ${opacity})`,
      border: "1px solid rgba(255, 255, 255, 0.07)",
      boxShadow: "var(--glass-shadow)",
    };
  }

  if (theme === "light") {
    return {
      backgroundColor: `rgba(250, 250, 252, ${Math.min(1, opacity * 0.82)})`,
      backdropFilter: "blur(20px) saturate(160%)",
      WebkitBackdropFilter: "blur(20px) saturate(160%)",
      border: "1px solid rgba(0, 0, 0, 0.08)",
      boxShadow:
        "0 18px 44px -16px rgba(0, 0, 0, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.65)",
    };
  }

  // Dark glass (default): the signature look.
  return {
    backgroundColor: `rgba(14, 15, 18, ${Math.min(0.92, opacity * 0.55)})`,
    backdropFilter: "blur(20px) saturate(160%)",
    WebkitBackdropFilter: "blur(20px) saturate(160%)",
    border: "1px solid var(--glass-stroke)",
    boxShadow: "var(--glass-shadow), inset 0 1px 0 var(--glass-stroke-top)",
  };
}
