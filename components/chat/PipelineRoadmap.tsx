"use client";
import { useEffect, useId, useMemo, useRef } from "react";
import {
  ClipboardPaste,
  Sparkles,
  GitBranch,
  MessagesSquare,
  FileCheck2,
  Check,
  AlertTriangle,
} from "lucide-react";
import { gsap, useGSAP, DrawSVGPlugin, MotionPathPlugin } from "@/lib/gsap-init";
import type { Session } from "@/lib/schemas/mcq";
import { deriveSteps, type StepState } from "@/components/chat/pipelineSteps";
import { cn } from "@/lib/utils";

void DrawSVGPlugin;
void MotionPathPlugin;

interface Milestone {
  id: string;
  label: string;
  state: StepState;
  Icon: typeof ClipboardPaste;
  hint?: string;
}

interface PipelineRoadmapProps {
  session: Session | null;
  isAnalyzing: boolean;
}

/* ──────────────────────────────────────────────────────────────
 *  Milestones — states from the shared deriveSteps, plus roadmap hints.
 * ────────────────────────────────────────────────────────────── */
function deriveMilestones(session: Session | null, isAnalyzing: boolean): Milestone[] {
  const lastRound = session?.rounds[session.rounds.length - 1];
  const status = session?.status ?? "analyzing";
  const pipelineStage = session?.pipeline_stage;
  const init = deriveSteps(session, isAnalyzing);

  const conf = session?.current_confidence;
  const roundN = session?.rounds.length ?? 0;
  const enrichment = lastRound?.github_enrichment;
  const matches = enrichment?.matches.length;
  const variantsRun = enrichment?.variants?.length ?? 0;
  const avgSim =
    enrichment && enrichment.matches.length > 0
      ? Math.round(
          (enrichment.matches.reduce((s, m) => s + m.similarity, 0) /
            enrichment.matches.length) *
            100,
        ) / 100
      : null;

  return [
    {
      id: "extract",
      label: "Extract",
      state: init.extract,
      Icon: ClipboardPaste,
      hint:
        pipelineStage === "extracting"
          ? "Reading requirements"
          : lastRound
            ? `${lastRound.extraction.modules.length} modules detected`
            : undefined,
    },
    {
      id: "github",
      label: "GitHub",
      state: init.github,
      Icon: GitBranch,
      hint:
        pipelineStage === "github"
          ? "Searching public repos"
          : matches != null
            ? avgSim != null
              ? `${matches} repos · ${variantsRun} queries · sim ${avgSim}`
              : `${matches} similar repos`
            : init.github === "pending"
              ? "Pending"
              : "No matches",
    },
    {
      id: "score",
      label: "Score",
      state: init.score,
      Icon: Sparkles,
      hint:
        pipelineStage === "scoring"
          ? "Calculating confidence"
          : conf != null
            ? `${conf}/100 confidence`
            : undefined,
    },
    {
      id: "decide",
      label:
        status === "blocker" ? "Blocker" : roundN > 1 ? `Round ${roundN}` : "Clarify",
      state: init.decide,
      Icon: MessagesSquare,
      hint:
        pipelineStage === "clarifying"
          ? "Preparing next step"
          : status === "error"
            ? "Needs a retry"
            : status === "blocker"
              ? "Need core info"
              : status === "awaiting_answers"
                ? "Awaiting answers"
                : status === "ready"
                  ? "Threshold met"
                  : init.decide === "pending"
                    ? "Pending"
                    : "Recomputing",
    },
    {
      id: "output",
      label: "Output",
      state: init.output,
      Icon: FileCheck2,
      hint:
        status === "finalized"
          ? "Two-stage scope ready"
          : status === "ready"
            ? "Generating now"
            : "Awaiting threshold",
    },
  ];
}

/* ──────────────────────────────────────────────────────────────
 *  Path geometry — gentle S-curve with 5 milestone anchors.
 * ────────────────────────────────────────────────────────────── */
const VIEWBOX_W = 240;
const VIEWBOX_H = 720;
const ANCHORS: Array<{ x: number; y: number }> = [
  { x: 60, y: 70 },
  { x: 175, y: 215 },
  { x: 60, y: 360 },
  { x: 175, y: 505 },
  { x: 60, y: 650 },
];

function buildPathD(): string {
  const a = ANCHORS;
  // Cubic bézier between each pair, control points pulled vertically so the
  // road has a deliberate snake shape.
  const segments: string[] = [`M ${a[0]!.x} ${a[0]!.y}`];
  for (let i = 1; i < a.length; i++) {
    const p0 = a[i - 1]!;
    const p1 = a[i]!;
    const c1x = p0.x;
    const c1y = p0.y + (p1.y - p0.y) * 0.55;
    const c2x = p1.x;
    const c2y = p0.y + (p1.y - p0.y) * 0.45;
    segments.push(`C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p1.x} ${p1.y}`);
  }
  return segments.join(" ");
}

const PATH_D = buildPathD();

/* ──────────────────────────────────────────────────────────────
 *  Component
 * ────────────────────────────────────────────────────────────── */
export function PipelineRoadmap({
  session,
  isAnalyzing,
}: PipelineRoadmapProps): React.ReactElement {
  const milestones = useMemo(
    () => deriveMilestones(session, isAnalyzing),
    [session, isAnalyzing],
  );
  const root = useRef<HTMLDivElement | null>(null);
  const lastStateRef = useRef<string[]>(milestones.map((m) => m.state));
  const uid = useId().replace(/[:]/g, "");

  // Compute progress (0..1) — fraction of the path that should be "lit".
  const progress = useMemo(() => {
    const N = milestones.length;
    let lit = 0;
    let i = 0;
    while (i < N && milestones[i]!.state === "done") {
      lit++;
      i++;
    }
    // A running step has reached its own anchor; it must not light the path
    // toward the following step. That made Clarify look like it had jumped
    // directly to Output.
    const frac = lit / (N - 1); // each anchor is 1/(N-1) of the path length
    return Math.min(1, Math.max(0, frac));
  }, [milestones]);

  // Initial draw-on of the dim path + first marker pop-in.
  useGSAP(
    () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) return;
      gsap.set(`#road-bg-${uid}`, { drawSVG: "0%" });
      gsap.set(`#road-active-${uid}`, { drawSVG: "0%" });
      gsap.set(".rm-marker-circle", { scale: 0, transformOrigin: "center" });

      const tl = gsap.timeline();
      tl.to(`#road-bg-${uid}`, {
        drawSVG: "100%",
        duration: 1.4,
        ease: "scopeai-out",
      }).to(
        ".rm-marker-circle",
        {
          scale: 1,
          duration: 0.5,
          stagger: 0.08,
          ease: "scopeai-bounce",
        },
        0.3,
      );
    },
    { scope: root, dependencies: [] },
  );

  // Animate the active path stroke whenever progress changes.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const path = document.getElementById(`road-active-${uid}`);
    if (!path) return;
    if (reduce) {
      gsap.set(path, { drawSVG: `0% ${progress * 100}%` });
      return;
    }
    gsap.to(path, {
      drawSVG: `0% ${progress * 100}%`,
      duration: 0.9,
      ease: "scopeai-out",
    });
  }, [progress, uid]);

  // Per-marker state transitions — pulse on done, scale on running, shake on error.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      lastStateRef.current = milestones.map((m) => m.state);
      return;
    }
    milestones.forEach((m, i) => {
      const prev = lastStateRef.current[i];
      if (prev === m.state) return;
      const node = document.querySelector<SVGCircleElement>(
        `[data-marker-id="${uid}-${m.id}"]`,
      );
      if (!node) return;
      if (m.state === "done") {
        gsap.fromTo(
          node,
          { scale: 1 },
          {
            scale: 1.5,
            duration: 0.18,
            yoyo: true,
            repeat: 1,
            ease: "scopeai-out",
            transformOrigin: "center",
          },
        );
      } else if (m.state === "running") {
        gsap.fromTo(
          node,
          { scale: 0.8 },
          {
            scale: 1,
            duration: 0.4,
            ease: "scopeai-bounce",
            transformOrigin: "center",
          },
        );
      } else if (m.state === "error") {
        gsap.fromTo(
          node,
          { x: -3 },
          {
            x: 3,
            duration: 0.07,
            repeat: 4,
            yoyo: true,
            onComplete: () => gsap.set(node, { x: 0 }),
          },
        );
      }
    });
    lastStateRef.current = milestones.map((m) => m.state);
  }, [milestones, uid]);

  // Continuous traveling pulse along the road (the "vehicle" on the journey).
  // Runs MotionPathPlugin to follow the path; only visible while there's a
  // running step.
  const hasRunning = milestones.some((m) => m.state === "running");
  useGSAP(
    () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) return;
      const dot = document.getElementById(`road-pulse-${uid}`);
      const path = document.getElementById(`road-bg-${uid}`) as SVGPathElement | null;
      if (!dot || !path) return;
      gsap.killTweensOf(dot);
      if (!hasRunning) {
        gsap.set(dot, { autoAlpha: 0 });
        return;
      }
      gsap.set(dot, { autoAlpha: 1 });
      gsap.to(dot, {
        motionPath: {
          path,
          alignOrigin: [0.5, 0.5],
          start: 0,
          end: progress,
        },
        duration: 2.4,
        repeat: -1,
        ease: "sine.inOut",
        yoyo: true,
      });
    },
    { scope: root, dependencies: [hasRunning, progress, uid] },
  );

  const conf = session?.current_confidence ?? 0;
  const status = session?.status ?? "idle";

  return (
    <div ref={root} className="relative">
      {/* Header */}
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <p className="text-blueprint-muted font-mono text-[10px] tracking-[0.22em] uppercase">
            Roadmap
          </p>
          <p className="text-blueprint-text font-display text-lg font-bold tracking-tight">
            {status === "ready" || status === "finalized"
              ? "Scope ready"
              : status === "blocker"
                ? "Blocker"
                : status === "awaiting_answers"
                  ? "Your turn"
                  : status === "analyzing"
                    ? "In motion"
                    : status === "error"
                      ? "Needs retry"
                      : "Idle"}
          </p>
        </div>
        <ConfidenceBadge value={conf} />
      </div>

      {/* SVG roadmap */}
      <div className="relative mt-2">
        <svg
          viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
          className="block h-auto w-full"
          aria-hidden
        >
          <defs>
            <linearGradient id={`road-grad-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a855f7" />
              <stop offset="55%" stopColor="#ec4899" />
              <stop offset="100%" stopColor="#fbbf24" />
            </linearGradient>
            <filter id={`road-glow-${uid}`}>
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Background dim path (full road) */}
          <path
            id={`road-bg-${uid}`}
            d={PATH_D}
            fill="none"
            stroke="rgba(168,85,247,0.18)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="6 8"
          />

          {/* Active path — drawn-on as progress advances */}
          <path
            id={`road-active-${uid}`}
            d={PATH_D}
            fill="none"
            stroke={`url(#road-grad-${uid})`}
            strokeWidth="3"
            strokeLinecap="round"
            filter={`url(#road-glow-${uid})`}
          />

          {/* Traveling pulse */}
          <circle
            id={`road-pulse-${uid}`}
            r="6"
            fill="#ec4899"
            filter={`url(#road-glow-${uid})`}
            style={{ opacity: 0 }}
          />

          {/* Milestone markers (positioned via foreignObject so React handles state) */}
          {milestones.map((m, i) => {
            const a = ANCHORS[i]!;
            return (
              <g key={m.id} transform={`translate(${a.x} ${a.y})`}>
                <circle
                  className="rm-marker-circle"
                  data-marker-id={`${uid}-${m.id}`}
                  r={m.state === "running" ? 14 : 12}
                  fill="#0a0518"
                  stroke={m.state === "pending" ? "rgba(168,85,247,0.35)" : "#ec4899"}
                  strokeWidth="2"
                  filter={
                    m.state === "running" || m.state === "done"
                      ? `url(#road-glow-${uid})`
                      : undefined
                  }
                />
                {/* Inline icon — uses foreignObject for native SVG-friendly Lucide */}
                <foreignObject x="-9" y="-9" width="18" height="18">
                  <div className="flex h-full w-full items-center justify-center">
                    {m.state === "done" ? (
                      <Check
                        className="text-[var(--color-blueprint-accent)]"
                        size={12}
                        strokeWidth={3}
                      />
                    ) : m.state === "error" ? (
                      <AlertTriangle className="text-red-400" size={12} strokeWidth={3} />
                    ) : (
                      <m.Icon
                        className={cn(
                          m.state === "pending"
                            ? "text-blueprint-muted"
                            : "text-[var(--color-blueprint-accent)]",
                        )}
                        size={11}
                        strokeWidth={2}
                      />
                    )}
                  </div>
                </foreignObject>
              </g>
            );
          })}
        </svg>

        {/* Side labels — overlay on top of SVG for crisp text. */}
        <div className="pointer-events-none absolute inset-0">
          {milestones.map((m, i) => {
            const a = ANCHORS[i]!;
            const onLeft = a.x > VIEWBOX_W / 2;
            const topPct = (a.y / VIEWBOX_H) * 100;
            return (
              <div
                key={m.id}
                className={cn(
                  "absolute flex -translate-y-1/2 flex-col gap-0.5",
                  onLeft
                    ? "right-[58%] items-end text-right"
                    : "left-[40%] items-start text-left",
                )}
                style={{ top: `${topPct}%` }}
              >
                <span
                  className={cn(
                    "text-[12px] leading-none font-semibold",
                    m.state === "pending"
                      ? "text-blueprint-muted"
                      : m.state === "running"
                        ? "text-[var(--color-blueprint-accent)]"
                        : "text-blueprint-text",
                  )}
                >
                  {m.label}
                </span>
                {m.hint && (
                  <span className="text-blueprint-muted text-[10px] leading-tight">
                    {m.hint}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Status footer */}
      <div className="text-blueprint-muted mt-4 flex items-center justify-between font-mono text-[10px] tracking-[0.18em] uppercase">
        <span>{status}</span>
        <span>{Math.round(progress * 100)}% complete</span>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
 *  Tiny embedded confidence badge (animated counter).
 * ────────────────────────────────────────────────────────────── */
function ConfidenceBadge({ value }: { value: number }): React.ReactElement {
  const ref = useRef<HTMLSpanElement | null>(null);
  const stateRef = useRef({ n: 0 });
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const span = ref.current;
    if (!span) return;
    if (reduce) {
      span.textContent = String(Math.round(value));
      return;
    }
    const t = gsap.to(stateRef.current, {
      n: value,
      duration: 0.9,
      ease: "scopeai-out",
      onUpdate: () => {
        span.textContent = String(Math.round(stateRef.current.n));
      },
    });
    return () => {
      t.kill();
    };
  }, [value]);
  return (
    <div className="border-blueprint-line/30 bg-blueprint-line/5 inline-flex items-baseline gap-1 rounded-full border px-3 py-1">
      <span
        ref={ref}
        className="font-mono text-sm font-bold text-[var(--color-blueprint-accent)] tabular-nums"
      >
        0
      </span>
      <span className="text-blueprint-muted font-mono text-[10px]">/100</span>
    </div>
  );
}
