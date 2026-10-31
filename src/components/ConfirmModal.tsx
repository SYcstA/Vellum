import { useEffect, useRef } from "react";
import { useAppStore } from "../store/useAppStore";
import { glassStyle } from "../utils/glass";

type ConfirmModalProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Optional middle action (e.g. "Discard"), shown between Cancel and Confirm. */
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** "danger" (default, red) or "primary" (indigo) for the confirm button. */
  confirmTone?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
};

function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  secondaryLabel,
  onSecondary,
  confirmTone = "danger",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const widgetThemeColor = useAppStore((s) => s.widgetThemeColor);
  const widgetOpacity = useAppStore((s) => s.widgetOpacity);
  const isLight = widgetThemeColor === "light";

  useEffect(() => {
    if (open) {
      setTimeout(() => confirmRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && e.target === confirmRef.current) onConfirm();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="relative glass-noise rounded-2xl p-5 w-80" style={glassStyle(widgetThemeColor, Math.max(widgetOpacity, 0.92))}>
        <p className={`text-sm font-semibold mb-2 ${isLight ? "text-gray-900" : "text-white/90"}`}>{title}</p>
        <p className={`text-xs mb-4 ${isLight ? "text-gray-500" : "text-white/60"}`}>{message}</p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className={`text-xs transition-colors px-3 py-1.5 rounded-lg ${isLight ? "text-gray-600 hover:text-gray-900 bg-black/5 hover:bg-black/10" : "text-white/50 hover:text-white/80 bg-white/5 hover:bg-white/10"}`}
          >
            {cancelLabel}
          </button>
          {secondaryLabel && onSecondary && (
            <button
              onClick={onSecondary}
              className="text-xs font-medium text-red-300 hover:text-red-200 bg-red-500/15 hover:bg-red-500/25 transition-colors px-3 py-1.5 rounded-lg"
            >
              {secondaryLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={`text-xs font-medium text-white transition-colors px-4 py-1.5 rounded-lg ${confirmTone === "primary" ? "bg-indigo-500/70 hover:bg-indigo-500/90" : "bg-red-500/50 hover:bg-red-500/70"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;