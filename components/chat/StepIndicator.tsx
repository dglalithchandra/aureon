"use client";
import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, AlertTriangle } from "lucide-react";
import { gsap } from "@/lib/gsap-init";
import { cn } from "@/lib/utils";

export type StepState = "pending" | "running" | "done" | "error";

export interface PipelineStepData {
  id: string;
  label: string;
  state: StepState;
  detail?: React.ReactNode;
}

interface StepIndicatorProps {
  step: PipelineStepData;
  index: number;
  expanded: boolean;
  onToggle(): void;
  isLast: boolean;
}

/**
 * Single step row. Reacts to `step.state` changes with a quick GSAP
 * "ping" — when a step transitions to done it pulses cyan; when it
 * starts running it scales subtly. Reduced motion is respected.
 */
export function StepIndicator({
  step,
  index,
  expanded,
  onToggle,
  isLast,
}: StepIndicatorProps): React.ReactElement {
  const numStr = String(index + 1).padStart(2, "0");
  const iconRef = useRef<HTMLSpanElement | null>(null);
  const lastStateRef = useRef<StepState>(step.state);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      lastStateRef.current = step.state;
      return;
    }
    const prev = lastStateRef.current;
    if (prev === step.state) return;
    const el = iconRef.current;
    if (!el) {
      lastStateRef.current = step.state;
      return;
    }
    if (step.state === "done" && prev === "running") {
      gsap.fromTo(
        el,
        { scale: 1 },
        {
          scale: 1.4,
          duration: 0.18,
          yoyo: true,
          repeat: 1,
          ease: "scopeai-out",
        },
      );
    } else if (step.state === "running") {
      gsap.fromTo(
        el,
        { scale: 0.8, opacity: 0.6 },
        {
          scale: 1,
          opacity: 1,
          duration: 0.35,
          ease: "scopeai-bounce",
        },
      );
    } else if (step.state === "error") {
      gsap.fromTo(
        el,
        { x: -6 },
        {
          x: 6,
          duration: 0.08,
          repeat: 4,
          yoyo: true,
          ease: "rough({ template: none.out, strength: 1.2, points: 8, taper: 'none', randomize: true, clamp: false })",
          onComplete: () => gsap.set(el, { x: 0 }),
        },
      );
    }
    lastStateRef.current = step.state;
  }, [step.state]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={`step-detail-${step.id}`}
        className={cn(
          "group flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition-colors",
          "hover:bg-blueprint-line/10 focus-visible:ring-2 focus-visible:ring-[var(--color-blueprint-accent)]/60 focus-visible:outline-none",
        )}
      >
        <span
          ref={iconRef}
          className={cn(
            "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] will-change-transform",
            step.state === "pending" && "border-blueprint-line/30 text-blueprint-muted",
            step.state === "running" &&
              "border-[var(--color-blueprint-accent)] bg-[var(--color-blueprint-accent)]/10 text-[var(--color-blueprint-accent)] shadow-[0_0_12px_rgba(236,72,153,0.5)]",
            step.state === "done" &&
              "border-[var(--color-blueprint-accent)] bg-[var(--color-blueprint-accent)]/10 text-[var(--color-blueprint-accent)]",
            step.state === "error" && "border-red-500/60 bg-red-500/10 text-red-400",
          )}
          aria-hidden
        >
          {step.state === "pending" && numStr}
          {step.state === "running" && <RunningDots />}
          {step.state === "done" && <Check size={14} strokeWidth={2.5} />}
          {step.state === "error" && <AlertTriangle size={14} strokeWidth={2.5} />}
        </span>

        <span className="flex flex-1 flex-col gap-0.5">
          <span
            className={cn(
              "text-sm font-medium transition-colors",
              step.state === "pending"
                ? "text-blueprint-muted"
                : step.state === "running"
                  ? "text-[var(--color-blueprint-accent)]"
                  : "text-blueprint-text",
            )}
          >
            {step.label}
          </span>
          <span className="text-blueprint-muted text-[11px] tracking-wide capitalize">
            {step.state}
          </span>
        </span>
      </button>

      {!isLast && (
        <span
          className={cn(
            "absolute top-9 left-[1.65rem] h-[calc(100%-1rem)] w-px transition-colors duration-500",
            step.state === "done"
              ? "bg-[var(--color-blueprint-accent)]/40"
              : "bg-blueprint-line/15",
          )}
          aria-hidden
        />
      )}

      <AnimatePresence initial={false}>
        {expanded && step.detail && (
          <motion.div
            id={`step-detail-${step.id}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="text-blueprint-muted ml-12 pt-1 pb-3 text-xs leading-relaxed">
              {step.detail}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RunningDots(): React.ReactElement {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !ref.current) return;
    const dots = ref.current.querySelectorAll<HTMLSpanElement>(".rdot");
    const tween = gsap.to(dots, {
      opacity: 1,
      scale: 1.3,
      duration: 0.6,
      stagger: { each: 0.15, repeat: -1, yoyo: true },
      ease: "sine.inOut",
    });
    return () => {
      tween.kill();
    };
  }, []);
  return (
    <span ref={ref} className="flex items-center gap-0.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="rdot block h-1 w-1 rounded-full bg-[var(--color-blueprint-accent)] opacity-30"
        />
      ))}
    </span>
  );
}
