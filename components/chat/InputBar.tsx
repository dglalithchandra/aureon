"use client";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import { gsap, useGSAP } from "@/lib/gsap-init";
import { cn } from "@/lib/utils";

const MAX_BYTES = 50_000;
const WARN_BYTES = 45_000;
const MAX_VISIBLE_LINES = 12;

interface InputBarProps {
  /** When true the input is locked (initial round running). */
  locked: boolean;
  /** When true the submit button shows a spinner. */
  pending: boolean;
  /** Optional sample prompts shown when the input is empty. */
  samples?: ReadonlyArray<{ label: string; text: string }>;
  /** Overrides the unlocked placeholder (e.g. when a rewrite is asked for). */
  placeholder?: string;
  /**
   * Called with the trimmed text. Caller is responsible for clearing the
   * field when its higher-level state moves forward.
   */
  onSubmit(text: string): void;
}

export interface InputBarHandle {
  focus(): void;
  setValue(v: string): void;
}

export const InputBar = forwardRef<InputBarHandle, InputBarProps>(function InputBar(
  { locked, pending, samples, placeholder, onSubmit },
  ref,
) {
  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
    setValue: (v: string) => {
      setValue(v);
      requestAnimationFrame(() => taRef.current?.focus());
    },
  }));

  // Page-level entrance: form slides up from bottom, sample chips stagger.
  useGSAP(
    () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) return;
      gsap.from("[data-input-form]", {
        y: 18,
        opacity: 0,
        duration: 0.6,
        ease: "scopeai-out",
      });
    },
    { scope: root, dependencies: [] },
  );

  // Sample-chip stagger entrance whenever they appear/change.
  useGSAP(
    () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) return;
      const chips = root.current?.querySelectorAll<HTMLElement>("[data-sample-chip]");
      if (!chips || chips.length === 0) return;
      gsap.from(chips, {
        opacity: 0,
        y: 8,
        duration: 0.45,
        stagger: 0.07,
        ease: "scopeai-out",
      });
    },
    { scope: root, dependencies: [Boolean(samples), value === "", locked] },
  );

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight || "20");
    const maxHeight = lineHeight * MAX_VISIBLE_LINES + 24; // padding
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
  }, [value]);

  const bytes = new Blob([value]).size;
  const overLimit = bytes > MAX_BYTES;
  const warn = bytes > WARN_BYTES;
  const trimmed = value.trim();
  const canSubmit = !locked && !pending && trimmed.length > 0 && !overLimit;

  function chipHover(e: React.PointerEvent<HTMLButtonElement>, enter: boolean): void {
    gsap.to(e.currentTarget, {
      y: enter ? -2 : 0,
      scale: enter ? 1.04 : 1,
      duration: 0.25,
      ease: "scopeai-out",
    });
  }

  function sendHover(e: React.PointerEvent<HTMLButtonElement>, enter: boolean): void {
    if (!canSubmit) return;
    gsap.to(e.currentTarget, {
      scale: enter ? 1.08 : 1,
      rotation: enter ? -8 : 0,
      duration: 0.3,
      ease: enter ? "scopeai-bounce" : "scopeai-out",
    });
  }

  const submit = (): void => {
    if (!canSubmit) return;
    onSubmit(trimmed);
    setValue("");
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onFormSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    submit();
  };

  return (
    <div
      ref={root}
      className="border-blueprint-line/15 bg-blueprint-bg/85 border-t backdrop-blur-md"
    >
      <div className="mx-auto w-full max-w-3xl px-4 py-4 sm:px-6">
        {!value && samples && samples.length > 0 && !locked && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Sparkles size={11} className="text-blueprint-accent shrink-0" aria-hidden />
            {samples.map((s) => (
              <button
                key={s.label}
                type="button"
                data-sample-chip
                onPointerEnter={(e) => chipHover(e, true)}
                onPointerLeave={(e) => chipHover(e, false)}
                onClick={() => {
                  setValue(s.text);
                  requestAnimationFrame(() => taRef.current?.focus());
                }}
                className="border-blueprint-line/25 text-blueprint-muted hover:text-blueprint-text rounded-full border px-3 py-1.5 text-xs transition-colors will-change-transform hover:border-[var(--color-blueprint-accent)]/50"
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        <form
          data-input-form
          onSubmit={onFormSubmit}
          className={cn(
            "border-blueprint-line/20 bg-blueprint-bg/60 flex items-end gap-2 rounded-2xl border p-2 transition-colors",
            "focus-within:border-[var(--color-blueprint-accent)]/50 focus-within:shadow-[0_0_24px_rgba(236,72,153,0.18)]",
            locked && "opacity-60",
          )}
        >
          <textarea
            ref={taRef}
            value={value}
            disabled={locked}
            rows={1}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKey}
            placeholder={
              locked
                ? "Pipeline is running…"
                : (placeholder ??
                  "Paste raw client requirements. Enter to submit, Shift+Enter for new line.")
            }
            className={cn(
              "text-blueprint-text placeholder:text-blueprint-muted/70 min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-sm leading-relaxed outline-none",
            )}
            aria-label="Project requirements input"
          />
          <button
            type="submit"
            disabled={!canSubmit}
            onPointerEnter={(e) => sendHover(e, true)}
            onPointerLeave={(e) => sendHover(e, false)}
            className={cn(
              "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl will-change-transform",
              canSubmit
                ? "bg-[var(--color-blueprint-accent)] text-[var(--color-blueprint-bg)] shadow-[0_0_24px_rgba(236,72,153,0.45)]"
                : "bg-blueprint-line/15 text-blueprint-muted cursor-not-allowed",
              "focus-visible:ring-2 focus-visible:ring-[var(--color-blueprint-accent)]/60 focus-visible:outline-none",
            )}
            aria-label="Submit"
          >
            {pending ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <ArrowUp size={16} strokeWidth={2.5} />
            )}
          </button>
        </form>

        <div className="text-blueprint-muted mt-2 flex items-center justify-between gap-2 text-[11px]">
          <span>
            {locked
              ? "Locked while the pipeline runs."
              : "Enter submits · Shift+Enter for newline"}
          </span>
          <span
            className={cn(
              "font-mono tabular-nums",
              overLimit && "text-red-400",
              !overLimit && warn && "text-amber-400",
            )}
          >
            {bytes.toLocaleString()} / {MAX_BYTES.toLocaleString()} bytes
          </span>
        </div>
        {overLimit && (
          <p className="mt-1 text-right text-[11px] text-red-400">
            Input exceeds 50KB limit. Trim before submitting.
          </p>
        )}
      </div>
    </div>
  );
});
