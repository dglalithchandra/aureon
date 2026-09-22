"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { ApiError, fetchSession, finalizeSession } from "@/lib/api/client";
import { useNow, useSessionEvents } from "@/lib/api/useSessionEvents";
import type { Session } from "@/lib/schemas/mcq";
import { SCOPING } from "@/lib/config/scoping";
import { isJobStalled } from "@/components/chat/polling";
import { OutputLayout } from "@/components/output/OutputLayout";
import { ClientView } from "@/components/output/ClientView";
import { EngineerView } from "@/components/output/EngineerView";

/** Poll interval while the event stream is not connected. */
const FALLBACK_POLL_MS = 2_000;

interface FinalizeGateProps {
  session: Session;
  initialTitle: string;
}

/**
 * If `session.final_output` exists we render the editor directly. Otherwise
 * we show a "Generate output" button that calls /api/finalize, which queues
 * the client and engineer views as two jobs (OPS-01). Each view is shown as
 * soon as it lands (Server-Sent Events, polling as a fallback). The session
 * MUST be in `ready` status — otherwise the chat sends the user back to
 * answer more questions.
 */
export function FinalizeGate({
  session: initialSession,
  initialTitle,
}: FinalizeGateProps): React.ReactElement {
  const [session, setSession] = useState(initialSession);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generating = session.pipeline_stage === "finalizing";
  const streaming = useSessionEvents(session.id, generating, setSession);

  useEffect(() => {
    if (!generating || streaming) return;
    const timer = setInterval(() => {
      fetchSession(session.id)
        .then(setSession)
        .catch(() => undefined);
    }, FALLBACK_POLL_MS);
    return () => clearInterval(timer);
  }, [generating, streaming, session.id]);

  // A finalize job that died leaves "finalizing" behind; offer a retry.
  const now = useNow(generating);
  const stalled = generating && isJobStalled(session.updated_at, now);

  if (session.final_output) {
    return (
      <OutputLayout
        sessionId={session.id}
        initialOutput={session.final_output}
        initialTitle={initialTitle}
      />
    );
  }

  if (session.status !== "ready" && !generating) {
    const lowConfidenceExhausted =
      session.rounds.length >= SCOPING.maxRounds &&
      session.current_confidence < SCOPING.confidenceThreshold;
    return (
      <main className="bg-blueprint-bg flex min-h-[100dvh] items-center justify-center px-6 py-16 text-center">
        <div className="max-w-lg">
          <p className="text-blueprint-muted font-mono text-[10px] tracking-[0.3em] uppercase">
            Not ready yet · {session.status}
          </p>
          <h1 className="text-blueprint-text font-display mt-3 text-2xl font-bold sm:text-3xl">
            {lowConfidenceExhausted
              ? "Confidence too low to lock the scope."
              : "Answer the remaining questions first."}
          </h1>
          <p className="text-blueprint-muted mt-3 text-sm">
            {lowConfidenceExhausted
              ? `${SCOPING.maxRounds} clarification rounds didn't lift confidence above the threshold of ${SCOPING.confidenceThreshold} (currently ${session.current_confidence}/100). Add a paragraph of detail in the chat — even one new sentence about goal or features can move the needle.`
              : "Aureon needs a bit more information before it can generate the two-stage output. Head back to the chat to continue."}
          </p>
          <Link
            href={`/chat?s=${session.id}`}
            className="mt-6 inline-flex items-center gap-2 rounded-full border border-[var(--color-blueprint-accent)] px-5 py-2.5 text-sm font-medium text-[var(--color-blueprint-accent)] hover:bg-[var(--color-blueprint-accent)]/15"
          >
            <ArrowLeft size={14} />
            Back to chat
          </Link>
        </div>
      </main>
    );
  }

  async function handleGenerate(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await finalizeSession(session.id);
      setSession(
        result.output
          ? { ...session, status: "finalized", final_output: result.output }
          : result.session,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not generate output.");
    } finally {
      setBusy(false);
    }
  }

  const draft = session.draft_output;
  if (generating || draft) {
    const failure = generating ? null : session.last_error;
    const notice =
      error ??
      (stalled
        ? "This is taking much longer than expected."
        : failure
          ? failure.retryable
            ? "The AI service had a problem. Anything already written is saved."
            : failure.message
          : null);
    const canRetry = !busy && (stalled || Boolean(failure?.retryable) || Boolean(error));
    return (
      <main className="bg-blueprint-bg min-h-[100dvh] px-4 py-10 sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-8">
          <header>
            <p className="text-blueprint-muted font-mono text-[10px] tracking-[0.3em] uppercase">
              {generating ? "Generating" : "Paused"}
            </p>
            <h1 className="text-blueprint-text font-display mt-2 text-2xl font-bold sm:text-3xl">
              {initialTitle}
            </h1>
            <p className="text-blueprint-muted mt-2 text-sm" aria-live="polite">
              {generating
                ? "Writing the client and engineer documents — each one appears here as soon as it is ready."
                : "One document is still missing."}
            </p>
            {notice && (
              <div
                role="alert"
                className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
              >
                <span>{notice}</span>
                {canRetry && (
                  <button
                    type="button"
                    onClick={handleGenerate}
                    className="inline-flex items-center gap-1.5 rounded-full border border-red-300/40 px-3 py-1 text-xs font-medium hover:bg-red-400/10"
                  >
                    <RefreshCw size={12} />
                    Try again
                  </button>
                )}
              </div>
            )}
          </header>
          <DraftSection title="Client view" writing={generating && !draft?.client}>
            {draft?.client && <ClientView view={draft.client} readOnly />}
          </DraftSection>
          <DraftSection title="Engineer view" writing={generating && !draft?.engineer}>
            {draft?.engineer && <EngineerView view={draft.engineer} readOnly />}
          </DraftSection>
        </div>
      </main>
    );
  }

  return (
    <main className="bg-blueprint-bg flex min-h-[100dvh] items-center justify-center px-6 py-16">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="border-blueprint-line/20 max-w-lg rounded-2xl border bg-white/[0.03] p-8 text-center backdrop-blur-md"
      >
        <Sparkles
          size={28}
          className="mx-auto mb-4 text-[var(--color-blueprint-accent)]"
        />
        <h1 className="text-blueprint-text font-display text-2xl font-bold sm:text-3xl">
          Ready to generate your scope.
        </h1>
        <p className="text-blueprint-muted mt-3 text-sm">
          We&apos;ll produce two documents in parallel — a plain-English client view and a
          concrete engineer build doc. Takes about 20-40 seconds.
        </p>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={busy}
          className="mt-6 inline-flex items-center gap-2 rounded-full border border-[var(--color-blueprint-accent)] bg-[var(--color-blueprint-accent)]/10 px-5 py-2.5 text-sm font-medium text-[var(--color-blueprint-accent)] hover:bg-[var(--color-blueprint-accent)]/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
          {busy ? "Generating…" : "Generate output"}
        </button>
        {error && (
          <p className="mt-4 text-sm text-red-300" role="alert">
            {error}
          </p>
        )}
      </motion.div>
    </main>
  );
}

function DraftSection({
  title,
  writing,
  children,
}: {
  title: string;
  writing: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="border-blueprint-line/20 rounded-2xl border bg-white/[0.02] p-5 sm:p-8">
      <h2 className="text-blueprint-muted mb-4 font-mono text-[11px] tracking-[0.2em] uppercase">
        {title}
      </h2>
      {children ??
        (writing ? (
          <p className="text-blueprint-muted inline-flex items-center gap-2 text-sm">
            <Loader2 className="animate-spin" size={14} />
            Writing…
          </p>
        ) : (
          <p className="text-blueprint-muted text-sm">Not written yet.</p>
        ))}
    </section>
  );
}
