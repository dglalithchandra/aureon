"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import { Home, RotateCcw } from "lucide-react";
import { BlueprintGrid } from "@/components/landing/BlueprintGrid";

export interface BrandedErrorProps {
  /** Optional headline override. */
  title?: string;
  /** Optional sub-message. */
  message?: string;
  /** Reload handler — typically `() => reset()` from a Next error boundary. */
  onReload?: () => void;
  /** When true the "Back home" link is hidden (used inside global-error). */
  hideHome?: boolean;
}

/**
 * Branded fallback used by:
 *   - app/error.tsx (per-segment errors)
 *   - app/global-error.tsx (root errors — wraps html/body itself)
 *   - the client error boundary in /chat and /output
 *
 * Pure-CSS background so it always renders, even when the bundler is in a
 * broken state (e.g. global-error rendering after a hydration crash).
 */
export function BrandedError({
  title = "Something broke.",
  message = "An unexpected error happened. The pipeline state is preserved — reload and you'll pick up where you were.",
  onReload,
  hideHome,
}: BrandedErrorProps): React.ReactElement {
  return (
    <main className="bg-blueprint-bg relative isolate flex min-h-[100dvh] items-center justify-center overflow-hidden px-6 py-16">
      <BlueprintGrid intensity="subtle" drift={false} />
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative z-10 w-full max-w-lg text-center"
      >
        <p className="text-blueprint-muted font-mono text-[10px] tracking-[0.3em] uppercase">
          ScopeAI · error
        </p>
        <h1 className="text-blueprint-text font-display mt-3 text-3xl font-bold sm:text-4xl">
          {title}
        </h1>
        <p className="text-blueprint-muted mt-4 text-sm leading-relaxed sm:text-base">
          {message}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {onReload && (
            <button
              type="button"
              onClick={onReload}
              className="border-blueprint-line/30 bg-blueprint-line/5 text-blueprint-text inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-medium hover:border-[var(--color-blueprint-accent)]/50"
            >
              <RotateCcw size={14} />
              Reload
            </button>
          )}
          {!hideHome && (
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--color-blueprint-accent)] bg-[var(--color-blueprint-accent)]/10 px-5 py-2.5 text-sm font-medium text-[var(--color-blueprint-accent)] hover:bg-[var(--color-blueprint-accent)]/20"
            >
              <Home size={14} />
              Back home
            </Link>
          )}
        </div>
      </motion.div>
    </main>
  );
}
