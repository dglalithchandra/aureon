"use client";
import { BadgeCheck } from "lucide-react";
import { moduleLevel, type ModuleConfidenceLevel } from "@/lib/scoring/modules";
import type { RepoLink } from "@/lib/schemas/github";
import { cn } from "@/lib/utils";

const TONE: Record<ModuleConfidenceLevel, string> = {
  HIGH: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  MEDIUM:
    "border-[var(--color-blueprint-accent)]/40 bg-[var(--color-blueprint-accent)]/10 text-[var(--color-blueprint-accent)]",
  LOW: "border-amber-400/40 bg-amber-400/10 text-amber-300",
};

/**
 * How sure the pipeline is about one module (blueprint step 07). HIGH above
 * 0.80, MEDIUM from 0.55, LOW below — LOW modules are the ones the client
 * view asks the reader to confirm.
 */
export function ModuleConfidenceChip({
  confidence,
  className,
}: {
  confidence: number | null;
  className?: string;
}): React.ReactElement | null {
  if (confidence === null) return null;
  const level = moduleLevel(confidence);
  return (
    <span
      title={`Module confidence ${Math.round(confidence * 100)}/100`}
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.18em] uppercase",
        TONE[level],
        className,
      )}
    >
      {level.toLowerCase()}
    </span>
  );
}

/**
 * "Seen in N similar projects", with links to those repositories. The repos
 * come from the round's verified matches, so every link is real (GOAL-02).
 */
export function SeenInRepos({
  seenIn,
  validated,
}: {
  seenIn: RepoLink[];
  validated: boolean;
}): React.ReactElement | null {
  if (seenIn.length === 0) {
    if (!validated) return null;
    return (
      <div className="text-blueprint-muted inline-flex items-center gap-1.5 text-[11px]">
        <BadgeCheck size={13} className="text-[var(--color-blueprint-accent)]" />
        Validated against similar open-source projects
      </div>
    );
  }
  return (
    <div className="text-blueprint-muted flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
      <span className="inline-flex items-center gap-1.5">
        <BadgeCheck size={13} className="text-[var(--color-blueprint-accent)]" />
        Seen in {seenIn.length} similar project{seenIn.length === 1 ? "" : "s"}:
      </span>
      {seenIn.map((repo) => (
        <a
          key={repo.url}
          href={repo.url}
          target="_blank"
          rel="noreferrer noopener"
          className="underline decoration-dotted underline-offset-2 hover:text-[var(--color-blueprint-accent)]"
        >
          {repo.repo}
        </a>
      ))}
    </div>
  );
}
