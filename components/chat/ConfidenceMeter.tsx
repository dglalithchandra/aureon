"use client";
import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { gsap } from "@/lib/gsap-init";
import { SCOPING } from "@/lib/config/scoping";
import {
  ConfidenceExplainer,
  type ConfidenceParts,
} from "@/components/ConfidenceExplainer";

interface ConfidenceMeterProps {
  value: number;
  threshold?: number;
  /** Components behind the score; when given, the meter explains itself. */
  parts?: ConfidenceParts;
}

/**
 * Confidence meter with a GSAP-animated tabular-nums counter and a gradient
 * fill that tweens to the new value smoothly. Uses a custom ease so the
 * acceleration feels deliberate, not generic.
 */
export function ConfidenceMeter({
  value,
  threshold = SCOPING.confidenceThreshold,
  parts,
}: ConfidenceMeterProps): React.ReactElement {
  const [explainerOpen, setExplainerOpen] = useState(false);
  const numberRef = useRef<HTMLSpanElement | null>(null);
  const barRef = useRef<HTMLSpanElement | null>(null);
  const stateRef = useRef({ n: 0 });

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const span = numberRef.current;
    const bar = barRef.current;
    if (!span || !bar) return;
    if (reduce) {
      span.textContent = String(Math.round(value));
      bar.style.width = `${Math.min(100, Math.max(0, value))}%`;
      return;
    }
    const tween = gsap.to(stateRef.current, {
      n: value,
      duration: 0.9,
      ease: "scopeai-out",
      onUpdate: () => {
        span.textContent = String(Math.round(stateRef.current.n));
      },
    });
    gsap.to(bar, {
      width: `${Math.min(100, Math.max(0, value))}%`,
      duration: 0.9,
      ease: "scopeai-out",
    });
    return () => {
      tween.kill();
    };
  }, [value]);

  return (
    <div className="border-blueprint-line/15 bg-blueprint-line/5 flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-blueprint-muted font-mono text-[10px] tracking-[0.2em] uppercase">
          Confidence
        </span>
        <div className="flex items-center gap-2">
          <span className="text-blueprint-muted text-[10px]">target {threshold}</span>
          {parts && (
            <button
              type="button"
              onClick={() => setExplainerOpen((open) => !open)}
              aria-expanded={explainerOpen}
              aria-controls="confidence-explainer"
              className="text-blueprint-muted hover:text-blueprint-text inline-flex items-center gap-1 rounded text-[10px] focus-visible:ring-2 focus-visible:ring-[var(--color-blueprint-accent)]/60 focus-visible:outline-none"
            >
              <Info size={11} />
              How is this calculated?
            </button>
          )}
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <span
          ref={numberRef}
          className="text-blueprint-text font-display text-3xl font-bold tabular-nums"
        >
          0
        </span>
        <span className="text-blueprint-muted text-sm">/ 100</span>
      </div>
      <div
        role="progressbar"
        aria-label="Scope confidence"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${value} out of 100, threshold ${threshold}`}
        className="bg-blueprint-line/20 relative h-1.5 w-full overflow-hidden rounded-full"
      >
        <span
          ref={barRef}
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: 0,
            backgroundImage:
              "linear-gradient(to right, var(--color-blueprint-line), var(--color-blueprint-accent))",
          }}
        />
        <span
          className="absolute inset-y-[-2px] w-px bg-[var(--color-blueprint-accent)]/50"
          style={{ left: `${threshold}%` }}
          aria-hidden
        />
      </div>
      {parts && explainerOpen && (
        <div
          id="confidence-explainer"
          className="border-blueprint-line/20 bg-blueprint-bg/60 mt-2 rounded-lg border p-3 text-xs"
        >
          <ConfidenceExplainer parts={parts} />
        </div>
      )}
    </div>
  );
}
