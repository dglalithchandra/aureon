"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { ApiError, finalizeSession } from "@/lib/api/client";
import type { Session } from "@/lib/schemas/mcq";
import { SCOPING } from "@/lib/config/scoping";
import { OutputLayout } from "@/components/output/OutputLayout";

interface FinalizeGateProps {
  session: Session;
  initialTitle: string;
}

/**
 * If `session.final_output` exists we render the editor directly. Otherwise
 * we show a "Generate output" button that calls /api/finalize. The session
 * MUST be in `ready` status — otherwise the chat sends the user back to
 * answer more questions.
 */
export function FinalizeGate({
  session,
  initialTitle,
}: FinalizeGateProps): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session.final_output) {
    return (
      <OutputLayout
        sessionId={session.id}
        initialOutput={session.final_output}
        initialTitle={initialTitle}
      />
    );
  }

  if (session.status !== "ready") {
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
      await finalizeSession(session.id);
      // Force the server component to re-render with the freshly persisted output.
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not generate output.");
    } finally {
      setBusy(false);
    }
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
