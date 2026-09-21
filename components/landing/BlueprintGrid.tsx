"use client";
import { cn } from "@/lib/utils";

/**
 * Reusable animated blueprint background. Pure CSS / inline SVG — no JS,
 * no images. Respects prefers-reduced-motion via the global CSS guard in
 * globals.css (animations are zeroed out when user has the OS setting on).
 *
 * `intensity`:
 *   - "subtle"  → 0.04 opacity, 60px grid (quiet content sections)
 *   - "normal"  → 0.07 opacity, 40px grid
 *   - "strong"  → 0.12 opacity, 40px grid + diagonal accents (hero)
 */
export interface BlueprintGridProps {
  intensity?: "subtle" | "normal" | "strong";
  drift?: boolean;
  className?: string;
}

export function BlueprintGrid({
  intensity = "normal",
  drift = true,
  className,
}: BlueprintGridProps): React.ReactElement {
  const opacity = intensity === "subtle" ? 0.04 : intensity === "strong" ? 0.12 : 0.07;
  const size = intensity === "subtle" ? 60 : 40;

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      <div
        className={cn("absolute inset-0", drift && "animate-grid-drift")}
        style={{
          backgroundColor: "var(--color-blueprint-bg)",
          backgroundImage: `
            linear-gradient(to right, rgba(168,85,247,${opacity}) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(168,85,247,${opacity}) 1px, transparent 1px)
          `,
          backgroundSize: `${size}px ${size}px`,
          willChange: drift ? "background-position" : undefined,
        }}
      />
      {intensity === "strong" && (
        <>
          <div
            className="absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(236,72,153,0.10), transparent 70%)",
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `
                linear-gradient(to right, rgba(168,85,247,0.18) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(168,85,247,0.18) 1px, transparent 1px)
              `,
              backgroundSize: "200px 200px",
            }}
          />
        </>
      )}

      {/* Animated drift keyframes scoped to this component. */}
      <style jsx>{`
        .animate-grid-drift {
          animation: grid-drift 60s linear infinite;
        }
        @keyframes grid-drift {
          from {
            background-position: 0 0;
          }
          to {
            background-position: ${size * 4}px ${size * 4}px;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-grid-drift {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
