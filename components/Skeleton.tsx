"use client";
import { cn } from "@/lib/utils";

/**
 * Tiny shimmer skeleton primitive. CSS-only so it has no JS cost. Heights
 * and widths must match the real component the skeleton is replacing —
 * there are no layout-shift surprises.
 */
export interface SkeletonProps {
  className?: string;
  /** Set to "circle" or "text" for common shapes. */
  variant?: "rect" | "text" | "circle";
  /** Roughly how many lines for text skeletons. */
  lines?: number;
}

export function Skeleton({
  className,
  variant = "rect",
  lines = 1,
}: SkeletonProps): React.ReactElement {
  if (variant === "text" && lines > 1) {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        {Array.from({ length: lines }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "block h-3 rounded-full",
              i === lines - 1 ? "w-3/5" : "w-full",
              shimmer,
            )}
          />
        ))}
      </div>
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        variant === "circle" ? "rounded-full" : "rounded-md",
        shimmer,
        className,
      )}
    />
  );
}

const shimmer =
  "relative isolate overflow-hidden bg-blueprint-line/10 before:absolute before:inset-0 before:-translate-x-full before:animate-[skeleton_1.6s_infinite] before:bg-gradient-to-r before:from-transparent before:via-blueprint-line/15 before:to-transparent motion-reduce:before:animate-none";

// Add the keyframe via a hidden <style> below — it's a one-time inject so
// every skeleton on the page can use it without each component owning it.
export function SkeletonKeyframes(): React.ReactElement {
  return (
    <style jsx global>{`
      @keyframes skeleton {
        100% { transform: translateX(100%); }
      }
    `}</style>
  );
}
