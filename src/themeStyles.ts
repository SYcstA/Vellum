// You can save this as: src/styles/themeStyles.ts

export const THEME_STYLES = {
  // ---------------------------------------------------------
  // 1. PREMIUM GLASS THEME (Dark/Transparent)
  // ---------------------------------------------------------
  // Apply this to the OUTERMOST ROOT CONTAINER of a widget when "Glass" is active.
  // CRITICAL RULE: All child elements inside must use 'bg-transparent' so the blur is not blocked.
  glassWrapper: "bg-black/30 backdrop-blur-xl border border-white/10 shadow-[0_8px_30px_rgb(0,0,0,0.3)] text-gray-100 rounded-xl",

  // ---------------------------------------------------------
  // 2. PREMIUM LIGHT THEME (Frosted White)
  // ---------------------------------------------------------
  // Apply this to the OUTERMOST ROOT CONTAINER of a widget when "Light" is active.
  // This creates a frosted glass effect with soft shadows.
  lightWrapper: "bg-white/50 backdrop-blur-xl border border-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.1)] text-slate-800 rounded-xl",

  // ---------------------------------------------------------
  // 3. LIGHT THEME CHILD ELEMENTS (Inputs, Textareas, List Items)
  // ---------------------------------------------------------
  // Apply this specifically to inner elements (inputs, task lists) ONLY when in Light Theme.
  // This provides a soft contrast against the transparent white wrapper.
  lightChildElements: "bg-white/40 border border-gray-200 placeholder-slate-400 focus:bg-white/60 focus:border-gray-400 transition-all text-slate-900 rounded-lg",
};

/* ===========================================================
USAGE EXAMPLE (How to implement in a component like TodoWidget.tsx):
===========================================================

import { THEME_STYLES } from '../styles/themeStyles';

export const ExampleWidget = ({ widgetThemeColor }) => {
  return (
    // 1. Parent Wrapper dynamically switches between Glass and Light
    <div className={`p-4 ${widgetThemeColor === 'Light' ? THEME_STYLES.lightWrapper : THEME_STYLES.glassWrapper}`}>
      
      // 2. Header (MUST be transparent to show the parent's blur)
      <div className="bg-transparent mb-2">
        <h2 className="font-bold">Widget Title</h2>
      </div>

      // 3. Input Element dynamically switches styling
      <input 
        type="text"
        placeholder="Enter task..."
        className={`w-full p-2 outline-none ${
          widgetThemeColor === 'Light' 
            ? THEME_STYLES.lightChildElements 
            : 'bg-transparent text-white border border-white/20'
        }`}
      />
      
    </div>
  );
};
*/