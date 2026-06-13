import { useAppStore } from "../store/useAppStore";

/**
 * Adaptive Vellum logo. The store's widgetThemeColor drives which variant we
 * inline-render so the mark stays legible against any glass backdrop:
 *   - "dark" / "pure-black" → frosted-white variant (logo.svg)
 *   - "light"               → dual-tone charcoal variant (logo_charcoal.svg)
 * Both viewBoxes are 512×512; sized via the wrapper width.
 */
function Logo({ size = 56 }: { size?: number }) {
  const widgetThemeColor = useAppStore((s) => s.widgetThemeColor);
  const useCharcoal = widgetThemeColor === "light";

  return (
    <div style={{ width: size, height: size }} aria-label="Vellum">
      {useCharcoal ? <LogoCharcoal /> : <LogoFrosted />}
    </div>
  );
}

/** Frosted-white variant — for dark/glass and pure-black themes. */
function LogoFrosted() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
      <defs>
        <linearGradient id="vellumGlassGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.25" />
        </linearGradient>
        <linearGradient id="vellumAccentGrad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#f8fafc" stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <circle cx="256" cy="256" r="220" fill="none" stroke="url(#vellumGlassGrad)" strokeWidth="6" strokeOpacity="0.4" strokeDasharray="300 40 20 40" />
      <path d="M140 160 L230 380 L275 380 L185 160 Z" fill="#ffffff" fillOpacity="0.15" stroke="url(#vellumGlassGrad)" strokeWidth="3" />
      <path d="M372 160 L282 380 L237 380 L327 160 Z" fill="url(#vellumAccentGrad)" fillOpacity="0.2" stroke="#ffffff" strokeWidth="4" strokeOpacity="0.9" />
      <circle cx="256" cy="318" r="5" fill="#ffffff" />
    </svg>
  );
}

/** Dual-tone charcoal variant — used in light mode so the mark stays visible. */
function LogoCharcoal() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
      <defs>
        <linearGradient id="vellumLightGlass" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.3" />
        </linearGradient>
        <linearGradient id="vellumDarkSlate" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0f172a" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#334155" stopOpacity="0.6" />
        </linearGradient>
      </defs>
      <circle cx="256" cy="256" r="220" fill="none" stroke="#64748b" strokeWidth="5" strokeOpacity="0.4" strokeDasharray="250 50 30 50" />
      <path d="M140 160 L230 380 L275 380 L185 160 Z" fill="url(#vellumDarkSlate)" stroke="#0f172a" strokeWidth="2" strokeOpacity="0.4" />
      <path d="M372 160 L282 380 L237 380 L327 160 Z" fill="url(#vellumLightGlass)" stroke="#ffffff" strokeWidth="3" strokeOpacity="0.85" />
      <circle cx="245" cy="318" r="4" fill="#38bdf8" />
    </svg>
  );
}

export default Logo;
