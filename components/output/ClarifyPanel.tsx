"use client";
import { useState } from "react";
import { Loader2, Send, X } from "lucide-react";
import {
  ApiError,
  clarifySession,
  fetchSession,
  finalizeSession,
} from "@/lib/api/client";
import type { Session } from "@/lib/schemas/mcq";
import type { FinalOutput } from "@/lib/schemas/output";
import { useModal } from "@/lib/hooks/useModal";

/**
 * Answering one open item without leaving the output page (UX-02).
 *
 * The answer starts a new round — the same job the chat uses — and when that
 * settles the scope is generated again, which writes a new version. The
 * regenerated document is handed back to the page, so nothing reloads.
 */

const POLL_MS = 1_500;
/** Long enough for a round plus both finalize jobs, short enough to give up. */
const MAX_WAIT_MS = 4 * 60_000;

interface ClarifyPanelProps {
  sessionId: string;
  /** The open item being answered. Empty when the panel was opened directly. */
  question: string;
  /** True while the page holds edits that regeneration would overwrite. */
  hasUnsavedEdits?: boolean;
  onClose(): void;
  onApplied(output: FinalOutput): void;
}

type Phase = "asking" | "rounding" | "generating";

const PHASE_TEXT: Record<Exclude<Phase, "asking">, string> = {
  rounding: "Re-reading the brief with your answer…",
  generating: "Writing the scope again…",
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  sessionId: string,
  done: (session: Session) => boolean,
): Promise<Session> {
  const deadline = Date.now() + MAX_WAIT_MS;
  for (;;) {
    await delay(POLL_MS);
    const session = await fetchSession(sessionId);
    if (done(session)) return session;
    if (session.last_error && !session.last_error.retryable) {
      throw new ApiError(session.last_error.code, session.last_error.message, 500);
    }
    if (Date.now() > deadline) {
      throw new ApiError(
        "TIMEOUT",
        "This is taking longer than expected. Reload the page to see where it got to.",
        504,
      );
    }
  }
}

export function ClarifyPanel({
  sessionId,
  question,
  hasUnsavedEdits = false,
  onClose,
  onApplied,
}: ClarifyPanelProps): React.ReactElement {
  const [answer, setAnswer] = useState("");
  const [phase, setPhase] = useState<Phase>("asking");
  const [error, setError] = useState<string | null>(null);
  const busy = phase !== "asking";
  // A side panel, not a modal: the document behind it stays readable, so
  // Escape and entry focus without the Tab trap (A11Y-01).
  const panel = useModal<HTMLElement>(
    true,
    () => {
      if (!busy) onClose();
    },
    { modal: false },
  );

  async function submit(): Promise<void> {
    if (!answer.trim() || busy) return;
    setError(null);
    setPhase("rounding");
    try {
      await clarifySession(sessionId, question, answer);
      await waitFor(sessionId, (s) => s.status !== "analyzing");
      setPhase("generating");
      // Override, because a round that ends with more questions is still a
      // scope worth regenerating — the confidence score says how sure it is.
      const result = await finalizeSession(sessionId, { override: true });
      const output =
        result.output ??
        (await waitFor(sessionId, (s) => s.status === "finalized" && !!s.final_output))
          .final_output;
      if (!output) throw new ApiError("NO_OUTPUT", "No scope came back.", 500);
      onApplied(output);
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not apply that clarification.",
      );
      setPhase("asking");
    }
  }

  return (
    <aside
      ref={panel}
      role="dialog"
      aria-label="Clarify an open item"
      data-testid="clarify-panel"
      className="border-blueprint-line/25 bg-blueprint-bg/95 fixed inset-x-0 bottom-0 z-30 border-t p-4 backdrop-blur-md sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[28rem] sm:rounded-2xl sm:border"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase">
            Clarify
          </p>
          {question && (
            <p className="text-blueprint-text mt-1 text-sm leading-relaxed">{question}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close clarify panel"
          disabled={busy}
          className="text-blueprint-muted hover:text-blueprint-text shrink-0 rounded-md p-1 disabled:opacity-40"
        >
          <X size={16} />
        </button>
      </div>

      {hasUnsavedEdits && (
        <p className="mt-3 rounded-lg border border-amber-400/40 bg-amber-400/5 px-3 py-2 text-xs text-amber-300">
          Save or cancel your edits first — regenerating the scope replaces them.
        </p>
      )}

      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={4}
        maxLength={4000}
        disabled={busy}
        aria-label="Your answer"
        placeholder="Answer in a sentence or two — it goes back through the pipeline."
        className="border-blueprint-line/30 text-blueprint-text mt-3 w-full resize-none rounded-lg border bg-white/[0.03] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-blueprint-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-blueprint-accent)]/40 disabled:opacity-60"
      />

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-300">
          {error}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-blueprint-muted text-xs" aria-live="polite">
          {busy ? PHASE_TEXT[phase] : "This creates a new round and a new version."}
        </p>
        <button
          type="button"
          onClick={submit}
          disabled={busy || hasUnsavedEdits || answer.trim().length === 0}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-blueprint-accent)] bg-[var(--color-blueprint-accent)]/10 px-4 py-1.5 text-xs font-medium text-[var(--color-blueprint-accent)] hover:bg-[var(--color-blueprint-accent)]/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="animate-spin" size={12} /> : <Send size={12} />}
          {busy ? "Working…" : "Send answer"}
        </button>
      </div>
    </aside>
  );
}
