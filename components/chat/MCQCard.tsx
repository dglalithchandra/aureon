"use client";
import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, Loader2, AlertCircle } from "lucide-react";
import { gsap, useGSAP } from "@/lib/gsap-init";
import type { MCQAnswer, MCQQuestion } from "@/lib/schemas/mcq";
import { cn } from "@/lib/utils";

interface MCQCardProps {
  questions: MCQQuestion[];
  pending: boolean;
  onSubmit(answers: MCQAnswer[]): void;
}

interface DraftAnswer {
  selected: Set<string>;
  custom: string;
}

const MAX_CUSTOM_CHARS = 1_500;

/**
 * Renders the current round's clarification questions as a single submit
 * unit. The user can pick options and/or type into the custom field; the
 * submit button stays disabled until at least one of the questions has
 * either a selection or non-empty custom text.
 */
export function MCQCard({
  questions,
  pending,
  onSubmit,
}: MCQCardProps): React.ReactElement | null {
  const root = useRef<HTMLElement | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftAnswer>>(() => {
    const init: Record<string, DraftAnswer> = {};
    for (const q of questions) init[q.id] = { selected: new Set(), custom: "" };
    return init;
  });

  useGSAP(
    () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) return;
      gsap.from("[data-mcq-q]", {
        opacity: 0,
        y: 12,
        duration: 0.5,
        stagger: 0.08,
        ease: "scopeai-out",
      });
      gsap.from("[data-mcq-opt]", {
        opacity: 0,
        x: -8,
        duration: 0.35,
        stagger: 0.04,
        ease: "scopeai-out",
        delay: 0.15,
      });
    },
    { scope: root, dependencies: [] },
  );

  if (questions.length === 0) return null;

  const isAnswerable = questions.some((q) => {
    const d = drafts[q.id];
    return d ? d.selected.size > 0 || d.custom.trim().length > 0 : false;
  });

  function toggleOption(qid: string, opt: string): void {
    setDrafts((prev) => {
      const cur = prev[qid] ?? { selected: new Set<string>(), custom: "" };
      const next = new Set(cur.selected);
      if (next.has(opt)) next.delete(opt);
      else next.add(opt);
      return { ...prev, [qid]: { ...cur, selected: next } };
    });
  }

  function setCustom(qid: string, value: string): void {
    if (value.length > MAX_CUSTOM_CHARS) return;
    setDrafts((prev) => {
      const cur = prev[qid] ?? { selected: new Set<string>(), custom: "" };
      return { ...prev, [qid]: { ...cur, custom: value } };
    });
  }

  function handleSubmit(): void {
    const out: MCQAnswer[] = [];
    for (const q of questions) {
      const d = drafts[q.id];
      if (!d) continue;
      if (d.selected.size === 0 && d.custom.trim().length === 0) continue;
      out.push({
        question_id: q.id,
        selected_options: Array.from(d.selected),
        custom_text: d.custom.trim() ? d.custom.trim() : null,
      });
    }
    if (out.length === 0) return;
    onSubmit(out);
  }

  return (
    <motion.section
      ref={root as unknown as React.Ref<HTMLElement>}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="border-blueprint-line/20 max-w-3xl rounded-2xl border bg-white/[0.03] p-6 backdrop-blur-md"
    >
      <header className="mb-4 flex items-center gap-2">
        <span
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-mono tracking-[0.18em] uppercase",
            questions.some((q) => q.is_blocker)
              ? "border-red-500/40 bg-red-500/10 text-red-300"
              : "border-[var(--color-blueprint-accent)]/40 bg-[var(--color-blueprint-accent)]/10 text-[var(--color-blueprint-accent)]",
          )}
        >
          {questions.some((q) => q.is_blocker) ? (
            <AlertCircle size={11} />
          ) : null}
          {questions.some((q) => q.is_blocker) ? "blocker" : "clarify"}
        </span>
        <h3 className="text-blueprint-text font-display text-base font-semibold">
          {questions.length === 1
            ? "One quick question"
            : `${questions.length} quick questions`}
        </h3>
      </header>

      <div className="flex flex-col gap-6">
        {questions.map((q) => {
          const draft = drafts[q.id] ?? { selected: new Set<string>(), custom: "" };
          return (
            <fieldset
              key={q.id}
              data-mcq-q
              className="flex flex-col gap-3"
            >
              <legend className="text-blueprint-text text-sm font-semibold">
                {q.question}
              </legend>
              <div role="group" className="flex flex-col gap-2">
                {q.options.map((opt) => {
                  const checked = draft.selected.has(opt);
                  return (
                    <label
                      key={opt}
                      data-mcq-opt
                      className={cn(
                        "group flex cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-2.5 text-sm transition-colors",
                        "focus-within:ring-2 focus-within:ring-[var(--color-blueprint-accent)]/60",
                        checked
                          ? "border-[var(--color-blueprint-accent)]/60 bg-[var(--color-blueprint-accent)]/[0.18] text-blueprint-text"
                          : "border-blueprint-line/20 hover:border-[var(--color-blueprint-accent)]/40 text-blueprint-text/90",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={checked}
                        onChange={() => toggleOption(q.id, opt)}
                        aria-label={`Select option: ${opt}`}
                      />
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                          checked
                            ? "border-[var(--color-blueprint-accent)] bg-[var(--color-blueprint-accent)] text-[var(--color-blueprint-bg)]"
                            : "border-blueprint-line/40 bg-transparent",
                        )}
                        aria-hidden
                      >
                        {checked && <Check size={11} strokeWidth={3} />}
                      </span>
                      <span>{opt}</span>
                    </label>
                  );
                })}
              </div>
              <div className="border-blueprint-line/20 flex flex-col gap-1 border-t pt-3">
                <label
                  htmlFor={`custom-${q.id}`}
                  className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase"
                >
                  + Add your own
                </label>
                <textarea
                  id={`custom-${q.id}`}
                  rows={2}
                  value={draft.custom}
                  onChange={(e) => setCustom(q.id, e.target.value)}
                  placeholder="Type a custom answer…"
                  className={cn(
                    "border-blueprint-line/20 bg-blueprint-bg/40 text-blueprint-text placeholder:text-blueprint-muted/70 resize-none rounded-md border px-3 py-2 text-sm outline-none",
                    "focus-visible:border-[var(--color-blueprint-accent)]/50 focus-visible:ring-2 focus-visible:ring-[var(--color-blueprint-accent)]/40",
                  )}
                />
                <div className="text-blueprint-muted text-right text-[10px]">
                  {draft.custom.length} / {MAX_CUSTOM_CHARS}
                </div>
              </div>
            </fieldset>
          );
        })}
      </div>

      <div className="mt-5 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!isAnswerable || pending}
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-5 py-2 text-sm font-medium transition-all",
            "border-[var(--color-blueprint-accent)] bg-[var(--color-blueprint-accent)]/15 text-[var(--color-blueprint-accent)]",
            "hover:bg-[var(--color-blueprint-accent)]/25",
            "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[var(--color-blueprint-accent)]/15",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blueprint-accent)]/60",
          )}
        >
          {pending ? <Loader2 className="animate-spin" size={14} /> : null}
          {pending ? "Submitting…" : "Submit answers"}
        </button>
      </div>
    </motion.section>
  );
}
