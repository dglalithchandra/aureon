"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ClipboardPaste,
  FileCheck2,
  GitBranch,
  MessagesSquare,
  Sparkles,
} from "lucide-react";
import { gsap, useGSAP } from "@/lib/gsap-init";
import { DrawSVGPlugin } from "@/lib/gsap-svg";
import type { Session } from "@/lib/schemas/mcq";
import { deriveSteps, type PipelineStepId } from "@/components/chat/pipelineSteps";
import { cn } from "@/lib/utils";

void DrawSVGPlugin;

interface PipelineRoadmapProps {
  session: Session | null;
  isAnalyzing: boolean;
}

const STEPS: ReadonlyArray<{
  id: PipelineStepId;
  label: string;
  idle: string;
  running: string;
  Icon: typeof ClipboardPaste;
}> = [
  { id: "extract", label: "Extract", idle: "Read the brief", running: "Reading requirements", Icon: ClipboardPaste },
  { id: "github", label: "GitHub", idle: "Find useful references", running: "Searching public repositories", Icon: GitBranch },
  { id: "score", label: "Score", idle: "Measure scope confidence", running: "Calculating confidence", Icon: Sparkles },
  { id: "decide", label: "Clarify", idle: "Resolve important gaps", running: "Choosing the next question", Icon: MessagesSquare },
  { id: "output", label: "Output", idle: "Create both project views", running: "Building your scope", Icon: FileCheck2 },
];

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function runningMessage(elapsedMs: number): string {
  if (elapsedMs >= 90_000) return "The free provider is busy. Automatic retries are still running.";
  if (elapsedMs >= 35_000) return "Free models can be slower at busy times. Your progress is saved.";
  return "Usually finishes in 20–60 seconds.";
}

export function PipelineRoadmap({
  session,
  isAnalyzing,
}: PipelineRoadmapProps): React.ReactElement {
  const root = useRef<HTMLDivElement | null>(null);
  const states = useMemo(() => deriveSteps(session, isAnalyzing), [session, isAnalyzing]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isAnalyzing) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [isAnalyzing]);

  const elapsedMs = session ? now - session.created_at : 0;
  const doneCount = STEPS.filter((step) => states[step.id] === "done").length;
  const active = STEPS.find((step) => states[step.id] === "running");
  const progress = active ? Math.min(96, doneCount * 20 + 10) : doneCount * 20;
  const status = session?.status ?? (isAnalyzing ? "analyzing" : "idle");

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.from("[data-roadmap-step]", {
        opacity: 0,
        x: -10,
        duration: 0.42,
        stagger: 0.06,
        ease: "scopeai-out",
      });
    },
    { scope: root, dependencies: [] },
  );

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const node = root.current?.querySelector<HTMLElement>("[data-active-step]");
    if (!node) return;
    gsap.fromTo(node, { scale: 0.985 }, { scale: 1, duration: 0.4, ease: "scopeai-bounce" });
  }, [active?.id]);

  return (
    <div ref={root} className="relative">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-blueprint-muted font-mono text-[10px] tracking-[0.2em] uppercase">
            Live pipeline
          </p>
          <h2 className="text-blueprint-text font-display mt-1 text-lg font-bold">
            {status === "error" ? "Needs attention" : isAnalyzing ? "Building your scope" : status === "finalized" ? "Scope complete" : "Ready to begin"}
          </h2>
        </div>
        <div className="border-blueprint-line/25 bg-white/[0.035] rounded-full border px-3 py-1.5 text-right">
          <p className="text-blueprint-muted text-[9px] tracking-wider uppercase">Elapsed</p>
          <p className="text-blueprint-text font-mono text-xs tabular-nums">{formatElapsed(elapsedMs)}</p>
        </div>
      </div>

      <div className="bg-blueprint-line/15 mt-4 h-1 overflow-hidden rounded-full">
        <div
          className="h-full rounded-full bg-gradient-to-r from-violet-500 via-pink-500 to-amber-400 shadow-[0_0_14px_rgba(236,72,153,0.55)] transition-[width] duration-700 ease-out"
          style={{ width: `${progress}%` }}
          role="progressbar"
          aria-label="Scope pipeline progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        />
      </div>

      <ol className="mt-4 space-y-2">
        {STEPS.map(({ id, label, idle, running, Icon }) => {
          const state = states[id];
          const isRunning = state === "running";
          return (
            <li
              key={id}
              data-roadmap-step
              data-active-step={isRunning ? "" : undefined}
              className={cn(
                "relative flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                isRunning && "border-pink-400/45 bg-pink-400/[0.08] shadow-[0_0_24px_rgba(236,72,153,0.12)]",
                state === "done" && "border-emerald-400/20 bg-emerald-400/[0.035]",
                state === "pending" && "border-blueprint-line/10 bg-white/[0.015]",
                state === "error" && "border-red-400/35 bg-red-400/[0.06]",
              )}
            >
              <span className={cn(
                "relative grid h-9 w-9 shrink-0 place-items-center rounded-lg border",
                isRunning && "border-pink-400/60 bg-pink-400/10 text-pink-300",
                state === "done" && "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
                state === "pending" && "border-blueprint-line/15 text-blueprint-muted",
                state === "error" && "border-red-400/40 bg-red-400/10 text-red-300",
              )}>
                {isRunning && <span className="absolute inset-0 animate-ping rounded-lg border border-pink-400/40 motion-reduce:hidden" />}
                {state === "done" ? <Check size={15} /> : state === "error" ? <AlertTriangle size={15} /> : <Icon size={15} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm font-semibold", state === "pending" ? "text-blueprint-muted" : "text-blueprint-text")}>{label}</span>
                <span className="text-blueprint-muted block truncate text-[11px]">{isRunning ? running : state === "done" ? "Completed" : state === "error" ? "Retry required" : idle}</span>
              </span>
              <span className={cn("font-mono text-[9px] tracking-wider uppercase", isRunning ? "text-pink-300" : state === "done" ? "text-emerald-300" : "text-blueprint-muted/70")}>
                {isRunning ? "Running" : state}
              </span>
            </li>
          );
        })}
      </ol>

      {isAnalyzing && (
        <div className="border-blueprint-line/15 bg-white/[0.025] mt-4 rounded-xl border px-3 py-3" aria-live="polite">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pink-400 motion-reduce:animate-none" />
            <p className="text-blueprint-text text-xs font-medium">{active?.running ?? "Starting pipeline"}</p>
          </div>
          <p className="text-blueprint-muted mt-1 pl-3.5 text-[11px] leading-relaxed">{runningMessage(elapsedMs)}</p>
        </div>
      )}
    </div>
  );
}
