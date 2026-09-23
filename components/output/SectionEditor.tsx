"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SectionEditorProps {
  value: string;
  multiline?: boolean;
  maxLength?: number;
  className?: string;
  inputClassName?: string;
  /** Called when the user confirms an edit. Caller is responsible for state. */
  onConfirm(next: string): void;
  /** Optional disabled state — disables the pencil affordance. */
  disabled?: boolean;
  /** Stand-in shown when the value is empty, so the field stays clickable. */
  placeholder?: string;
  /** Fields that may legitimately be blank, such as a module's notes. */
  allowEmpty?: boolean;
  ariaLabel: string;
}

/**
 * Inline editable text. Click the value (or pencil) to enter edit mode;
 * confirm with the check button or Enter, cancel with the X or Escape.
 *
 * Edits are reported to the caller via `onConfirm`. The component itself
 * does not persist anywhere — that's the parent's job (batch save).
 */
export function SectionEditor(props: SectionEditorProps): React.ReactElement {
  // Bind the editor to `value` via a remount key so the draft state always
  // tracks the canonical value when the parent updates it (no setState-in-effect).
  return <SectionEditorInner key={props.value} {...props} />;
}

function SectionEditorInner({
  value,
  multiline = false,
  maxLength,
  className,
  inputClassName,
  onConfirm,
  disabled,
  placeholder = "—",
  allowEmpty = false,
  ariaLabel,
}: SectionEditorProps): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [editing]);

  function handleConfirm(): void {
    const trimmed = draft.trim();
    if (!trimmed && !allowEmpty) {
      setEditing(false);
      setDraft(value);
      return;
    }
    if (trimmed !== value) onConfirm(trimmed);
    setEditing(false);
  }

  function handleCancel(): void {
    setEditing(false);
    setDraft(value);
  }

  if (editing) {
    return (
      <div className={cn("relative flex items-start gap-2", className)}>
        {multiline ? (
          <textarea
            ref={(el) => {
              inputRef.current = el;
            }}
            rows={4}
            value={draft}
            maxLength={maxLength}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") handleCancel();
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleConfirm();
            }}
            aria-label={ariaLabel}
            className={cn(
              "border-blueprint-line/30 text-blueprint-text bg-blueprint-bg/40 flex-1 resize-none rounded-md border px-3 py-2 text-sm leading-relaxed outline-none focus-visible:border-[var(--color-blueprint-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-blueprint-accent)]/40",
              inputClassName,
            )}
          />
        ) : (
          <input
            ref={(el) => {
              inputRef.current = el;
            }}
            type="text"
            value={draft}
            maxLength={maxLength}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") handleCancel();
              if (e.key === "Enter") handleConfirm();
            }}
            aria-label={ariaLabel}
            className={cn(
              "border-blueprint-line/30 text-blueprint-text bg-blueprint-bg/40 flex-1 rounded-md border px-3 py-1.5 text-sm outline-none focus-visible:border-[var(--color-blueprint-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-blueprint-accent)]/40",
              inputClassName,
            )}
          />
        )}
        <button
          type="button"
          onClick={handleConfirm}
          aria-label="Confirm edit"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-blueprint-accent)] text-[var(--color-blueprint-accent)] hover:bg-[var(--color-blueprint-accent)]/15"
        >
          <Check size={14} />
        </button>
        <button
          type="button"
          onClick={handleCancel}
          aria-label="Cancel edit"
          className="border-blueprint-line/30 text-blueprint-muted hover:text-blueprint-text inline-flex h-8 w-8 items-center justify-center rounded-md border"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  if (disabled) {
    return (
      <div
        className={cn(
          "text-blueprint-text flex-1 leading-relaxed",
          multiline && "whitespace-pre-wrap",
          className,
        )}
      >
        {value || <span className="text-blueprint-muted">{placeholder}</span>}
      </div>
    );
  }

  // Whole value is a click target. A persistent dashed underline + a
  // low-opacity pencil signal "editable" without a hover; both intensify on
  // hover/focus so the affordance is discoverable but not noisy.
  return (
    <div className={cn("group relative flex items-start gap-2", className)} role="group">
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Edit ${ariaLabel}`}
        title={`Click to edit ${ariaLabel}`}
        className={cn(
          "text-blueprint-text flex-1 cursor-text rounded-md px-1.5 py-1 text-left leading-relaxed transition-colors",
          "underline decoration-[var(--color-blueprint-accent)]/40 decoration-dashed decoration-1 underline-offset-4",
          "hover:bg-[var(--color-blueprint-accent)]/8 hover:decoration-[var(--color-blueprint-accent)]/80",
          "focus-visible:ring-2 focus-visible:ring-[var(--color-blueprint-accent)]/50 focus-visible:outline-none",
          multiline && "whitespace-pre-wrap",
        )}
      >
        {value || <span className="text-blueprint-muted">{placeholder}</span>}
      </button>
      <button
        type="button"
        aria-label={`Edit ${ariaLabel}`}
        onClick={() => setEditing(true)}
        className={cn(
          "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--color-blueprint-accent)]/30 text-[var(--color-blueprint-accent)]/60 opacity-60 transition-all",
          "group-hover:opacity-100 hover:bg-[var(--color-blueprint-accent)]/15 hover:text-[var(--color-blueprint-accent)] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--color-blueprint-accent)]/50 focus-visible:outline-none",
        )}
      >
        <Pencil size={12} />
      </button>
    </div>
  );
}
