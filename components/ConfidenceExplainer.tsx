"use client";
import { SCOPING } from "@/lib/config/scoping";

/** The score and the components behind it, as the UI shows them. */
export interface ConfidenceParts {
  coverage: number;
  aiClarity: number;
  consistency: number;
  githubBonus: number;
  /** The ceiling that applied: 40, 65, or 100 when none did. */
  cap: number;
}

const pct = (weight: number): string => `${Math.round(weight * 100)}%`;

function capLine(cap: number): string {
  if (cap === SCOPING.blockerCap) {
    return `Held at ${cap} until you say what the project is for and what it must do.`;
  }
  if (cap === SCOPING.criticalCap) {
    return `Held at ${cap} until you say who uses it and any tech constraints.`;
  }
  return "No ceiling applied — every key area has something in it.";
}

/**
 * "How is this calculated?" in plain English, shared by the chat meter and
 * the output badge so both tell the same story (ARCH-01). The score is
 * worked out from the answers, not graded by the AI.
 */
export function ConfidenceExplainer({
  parts,
}: {
  parts: ConfidenceParts;
}): React.ReactElement {
  const w = SCOPING.scoreWeights;
  return (
    <div className="text-left">
      <p className="text-blueprint-text mb-2 font-semibold">How is this calculated?</p>
      <ul className="text-blueprint-muted flex flex-col gap-1.5">
        <Row label={`Coverage (${pct(w.coverage)})`} value={parts.coverage} />
        <Row label={`AI clarity read (${pct(w.quality)})`} value={parts.aiClarity} />
        <Row label={`Consistency (${pct(w.consistency)})`} value={parts.consistency} />
        <Row
          label="GitHub bonus"
          value={parts.githubBonus}
          suffix={` / ${SCOPING.githubBonusMax}`}
        />
      </ul>
      <p className="text-blueprint-muted mt-3 text-[10.5px] leading-snug">
        Aureon works the score out from what you wrote; the AI does not grade its own
        answer. <strong>Coverage</strong> is how much of the nine scope areas your brief
        covers, weighted by how much each one matters. The{" "}
        <strong>AI clarity read</strong> is the one part the model contributes: how
        clearly your brief reads. <strong>Consistency</strong> rewards those two agreeing.
        The <strong>GitHub bonus</strong> adds up to {SCOPING.githubBonusMax} points when
        similar public projects back up your modules.
      </p>
      <p className="text-blueprint-muted mt-2 text-[10.5px] leading-snug">
        {capLine(parts.cap)}
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number;
  suffix?: string;
}): React.ReactElement {
  return (
    <li className="flex items-center gap-2">
      <span className="w-36 shrink-0">{label}</span>
      <span className="bg-blueprint-line/20 relative h-1.5 flex-1 overflow-hidden rounded-full">
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${Math.max(0, Math.min(100, value))}%`,
            backgroundImage:
              "linear-gradient(to right, var(--color-blueprint-line), var(--color-blueprint-accent))",
          }}
        />
      </span>
      <span className="text-blueprint-text w-12 text-right font-mono tabular-nums">
        {value}
        {suffix}
      </span>
    </li>
  );
}
