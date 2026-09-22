"use client";
import { useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { gsap, useGSAP } from "@/lib/gsap-init";
import type { Session } from "@/lib/schemas/mcq";
import { ConfidenceMeter } from "@/components/chat/ConfidenceMeter";
import { StepIndicator } from "@/components/chat/StepIndicator";
import {
  deriveSteps,
  PIPELINE_STEP_IDS,
  type PipelineStepId,
  type StepState,
} from "@/components/chat/pipelineSteps";
import { cn } from "@/lib/utils";

interface PipelinePanelProps {
  session: Session | null;
  isAnalyzing: boolean;
  className?: string;
}

type StepId = PipelineStepId;

const STEP_LABELS: Record<StepId, string> = {
  extract: "Extract",
  github: "GitHub Search",
  score: "Score",
  decide: "Question or Finalize",
  output: "Output",
};

/**
 * Step states come from the shared deriveSteps (live `pipeline_stage` while
 * analyzing); this adds the panel's expandable details from the last round.
 */
function buildSteps(
  session: Session | null,
  isAnalyzing: boolean,
): Array<{ id: StepId; state: StepState; detail?: React.ReactNode }> {
  const lastRound = session?.rounds[session.rounds.length - 1];
  const status = session?.status ?? "analyzing";
  const init = deriveSteps(session, isAnalyzing);

  if (!session || !lastRound) {
    return PIPELINE_STEP_IDS.map((id) => ({ id, state: init[id] }));
  }

  const steps: Array<{ id: StepId; state: StepState; detail?: React.ReactNode }> = [];

  for (const id of PIPELINE_STEP_IDS) {
    let detail: React.ReactNode | undefined;
    if (id === "extract" && init.extract === "done") {
      const e = lastRound.extraction;
      detail = (
        <ul className="space-y-1">
          <li>
            Domain: <span className="text-blueprint-text">{e.domain}</span> (
            {e.domain_confidence}%)
          </li>
          <li>Modules detected: {e.modules.length}</li>
          <li>Open questions: {e.open_questions.length}</li>
        </ul>
      );
    }
    if (id === "github") {
      const m = lastRound.github_enrichment;
      if (!m) {
        detail = (
          <p>
            No similar open-source projects found — your scope is being built from the AI
            signal alone.
          </p>
        );
      } else if (m.matches.length === 0) {
        detail = (
          <p>
            No matches surfaced. Query: <code>{m.query_used}</code>
          </p>
        );
      } else {
        detail = (
          <div className="space-y-2">
            <p>
              {m.matches.length} similar repos via {m.variants?.length ?? 1} query
              variants:
            </p>
            <ul className="space-y-2">
              {m.matches.slice(0, 5).map((r) => (
                <li
                  key={r.repo}
                  className="border-blueprint-line/15 bg-blueprint-line/5 rounded-md border px-2 py-1.5"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-blueprint-accent truncate font-medium">
                      {r.repo}
                    </span>
                    <span className="text-blueprint-muted shrink-0 font-mono text-[10px]">
                      ★{r.stars} · sim {r.similarity.toFixed(2)}
                    </span>
                  </div>
                  {r.why_relevant && (
                    <p className="text-blueprint-muted/90 mt-1 text-[11px] leading-snug italic">
                      {r.why_relevant}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      }
    }
    if (id === "score" && init.score === "done") {
      detail = (
        <p>
          Confidence:{" "}
          <span className="text-blueprint-text">
            {lastRound.extraction.confidence}/100
          </span>
          . Blocker: {lastRound.extraction.blocker ? "yes" : "no"}.
        </p>
      );
    }
    if (id === "decide") {
      if (status === "error") {
        detail = <p>The AI service had a problem. Your answers are saved — use Retry.</p>;
      } else if (status === "blocker") {
        detail = <p>Goal or features missing — answer the blocker question.</p>;
      } else if (status === "needs_input") {
        detail = <p>Goal or features still missing — describe them in the chat.</p>;
      } else if (status === "awaiting_answers") {
        detail = (
          <p>Round {lastRound.round_number + 1}: clarification questions ready.</p>
        );
      } else if (status === "ready") {
        detail = (
          <p>
            Threshold met. Click <strong>Generate output</strong>.
          </p>
        );
      } else if (status === "finalized") {
        detail = <p>Done.</p>;
      }
    }
    if (id === "output" && status === "finalized") {
      detail = <p>Two-stage scope ready.</p>;
    }
    steps.push({ id, state: init[id], detail });
  }
  return steps;
}

export function PipelinePanel({
  session,
  isAnalyzing,
  className,
}: PipelinePanelProps): React.ReactElement {
  const root = useRef<HTMLElement | null>(null);
  const steps = useMemo(() => buildSteps(session, isAnalyzing), [session, isAnalyzing]);
  const [expandedId, setExpandedId] = useState<StepId | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const confidence = session?.current_confidence ?? 0;

  // Stagger steps on initial mount.
  useGSAP(
    () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) return;
      gsap.from("[data-pipeline-step]", {
        opacity: 0,
        x: -10,
        duration: 0.35,
        stagger: 0.06,
        ease: "scopeai-out",
      });
    },
    { scope: root, dependencies: [] },
  );

  const body = (
    <>
      <ConfidenceMeter value={confidence} />
      <div
        className="border-blueprint-line/15 bg-blueprint-line/5 mt-4 flex flex-col gap-1 rounded-lg border p-3"
        aria-live="polite"
      >
        {steps.map((step, i) => (
          <div key={step.id} data-pipeline-step>
            <StepIndicator
              index={i}
              isLast={i === steps.length - 1}
              expanded={expandedId === step.id}
              onToggle={() =>
                setExpandedId((prev) => (prev === step.id ? null : step.id))
              }
              step={{
                id: step.id,
                label: STEP_LABELS[step.id],
                state: step.state,
                detail: step.detail,
              }}
            />
          </div>
        ))}
      </div>
    </>
  );

  return (
    <aside
      ref={root}
      className={cn(
        "border-blueprint-line/15 bg-blueprint-bg/80 rounded-xl border backdrop-blur-md",
        className,
      )}
    >
      {/* Mobile accordion header */}
      <button
        type="button"
        onClick={() => setMobileOpen((v) => !v)}
        aria-expanded={mobileOpen}
        className="flex w-full items-center justify-between p-4 md:hidden"
      >
        <span className="text-blueprint-muted font-mono text-[10px] tracking-[0.2em] uppercase">
          Pipeline · {session?.status ?? "idle"}
        </span>
        <motion.span animate={{ rotate: mobileOpen ? 180 : 0 }}>
          <ChevronDown size={18} className="text-blueprint-muted" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {mobileOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden md:hidden"
          >
            <div className="px-4 pb-4">{body}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop persistent panel */}
      <div className="hidden p-5 md:block">
        <p className="text-blueprint-muted mb-4 font-mono text-[10px] tracking-[0.2em] uppercase">
          Pipeline · {session?.status ?? "idle"}
        </p>
        {body}
      </div>
    </aside>
  );
}
