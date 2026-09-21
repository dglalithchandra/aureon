"use client";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import type { ConfidenceBadge as ConfidenceBadgeData } from "@/lib/schemas/output";

interface ConfidenceBadgeProps {
  badge: ConfidenceBadgeData;
  size?: "sm" | "md" | "lg";
}

export function ConfidenceBadge({
  badge,
  size = "md",
}: ConfidenceBadgeProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const motionValue = useMotionValue(0);
  const rounded = useTransform(motionValue, (v) => Math.round(v));

  useEffect(() => {
    const controls = animate(motionValue, badge.score, {
      duration: 0.9,
      ease: "easeOut",
    });
    return controls.stop;
  }, [badge.score, motionValue]);

  const tone = badge.score >= 80 ? "high" : badge.score >= 60 ? "mid" : "low";

  const colors: Record<typeof tone, string> = {
    high: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
    mid: "border-[var(--color-blueprint-accent)]/40 bg-[var(--color-blueprint-accent)]/10 text-[var(--color-blueprint-accent)]",
    low: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  };

  const sizes = {
    sm: "px-2.5 py-1 text-xs",
    md: "px-3 py-1.5 text-sm",
    lg: "px-4 py-2 text-base",
  } as const;

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        aria-describedby="confidence-tooltip"
        className={`inline-flex items-center gap-1.5 rounded-full border ${colors[tone]} ${sizes[size]} font-mono tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blueprint-accent)]/60`}
      >
        <motion.span>{rounded}</motion.span>
        <span className="opacity-70">/100</span>
        <Info size={12} className="opacity-70" />
      </button>
      {open && (
        <motion.div
          id="confidence-tooltip"
          role="tooltip"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="border-blueprint-line/30 bg-blueprint-bg/95 absolute top-full right-0 z-30 mt-2 w-72 rounded-lg border p-4 text-left text-xs shadow-xl backdrop-blur-md"
        >
          <p className="text-blueprint-text mb-2 font-semibold">Confidence breakdown</p>
          <ul className="text-blueprint-muted flex flex-col gap-1.5">
            <BarRow label="Coverage" value={badge.breakdown.coverage} />
            <BarRow label="Clarity" value={badge.breakdown.llm_quality} />
            <BarRow label="Real-world match" value={badge.breakdown.github_validation} />
          </ul>
          <p className="text-blueprint-muted mt-3 text-[10.5px] leading-snug">
            Coverage = parameter completeness · Clarity = how specific the input was ·
            Real-world match = corroboration from similar repos.
          </p>
        </motion.div>
      )}
    </div>
  );
}

function BarRow({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <li className="flex items-center gap-2">
      <span className="w-32 shrink-0">{label}</span>
      <span className="bg-blueprint-line/20 relative h-1.5 flex-1 overflow-hidden rounded-full">
        <motion.span
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            backgroundImage:
              "linear-gradient(to right, var(--color-blueprint-line), var(--color-blueprint-accent))",
          }}
        />
      </span>
      <span className="text-blueprint-text w-8 text-right font-mono tabular-nums">
        {value}
      </span>
    </li>
  );
}
