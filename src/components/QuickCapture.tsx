import { useEffect, useRef, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createNote, createTask } from "../store/db";
import { parseCapture } from "../utils/capture";
import { glassStyle } from "../utils/glass";
import "../App.css";

/** Where quick-captured tasks land; Tasks.Category_ID is NOT NULL so one is needed. */
const INBOX = "Inbox";

/**
 * Tiny always-on-top window opened by the global capture hotkey. Talks to the
 * database directly (no store boot, no schema init: the running main window
 * owns that) and tells the main window to reload.
 */
function QuickCapture() {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const close = () => { void getCurrentWindow().close(); };

  const save = async () => {
    const parsed = parseCapture(value);
    if (!parsed || busy) return;
    setBusy(true);
    try {
      if (parsed.kind === "task") await createTask(parsed.title, [INBOX]);
      else await createNote(parsed.title, "");
      await emit("data-changed");
      close();
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  return (
    <div className="w-screen h-screen p-2">
      <div className="relative glass-noise w-full h-full rounded-2xl p-4 flex flex-col justify-center gap-2" style={glassStyle("dark", 0.95)}>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(""); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") close();
          }}
          placeholder="Add a task…   or  n: a quick note"
          className="w-full bg-white/10 border border-indigo-400/50 rounded-lg px-3 py-2 text-sm text-white/90 placeholder:text-white/30 outline-none"
        />
        <p className="text-[10px] text-white/40">
          {error ? <span className="text-red-400">{error}</span> : "Enter to save to Inbox · n: makes a note · Esc to close"}
        </p>
      </div>
    </div>
  );
}

export default QuickCapture;
