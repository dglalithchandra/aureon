"use client";
import { useState } from "react";
import { ChevronDown, Minus, Plus } from "lucide-react";
import { SCOPING } from "@/lib/config/scoping";
import {
  bandWithLabel,
  clampTeam,
  planSprints,
  pointsFor,
  velocityFor,
  type EffortModule,
  type SprintPlanRow,
} from "@/lib/scoring/effort";
import type { EffortSummary as EffortSummaryData } from "@/lib/schemas/output";
import { cn } from "@/lib/utils";

/**
 * The effort estimate (blueprint step 10). Every number was computed on the
 * server by lib/scoring/effort.ts; this only re-runs the same functions when
 * the reader tries a different team size, so the panel can never disagree
 * with the document it came from.
 */

export interface RecomputedEstimate {
  teamSize: number;
  velocity: number;
  sprints: number;
  lowSprints: number;
  highSprints: number;
  reliable: boolean;
  bandLabel: string;
  plan: SprintPlanRow[];
}

/** The modules behind the estimate, as the effort engine sees them. */
export function basisModules(summary: EffortSummaryData): EffortModule[] {
  return summary.basis.map((m) => ({
    name: m.name,
    size: m.size,
    basePoints: pointsFor(m.size),
    points: m.points,
  }));
}

/** The estimate for a given team size, using the engine, not new arithmetic. */
export function recomputeEstimate(
  summary: EffortSummaryData,
  teamSize: number,
): RecomputedEstimate {
  const size = clampTeam(teamSize);
  const velocity = velocityFor(size);
  const sprints = Math.max(1, Math.ceil(summary.total_points / velocity));
  const band = bandWithLabel(summary.confidence_band, sprints);
  return {
    teamSize: size,
    velocity,
    sprints,
    lowSprints: band.lowSprints,
    highSprints: band.highSprints,
    reliable: band.reliable,
    bandLabel: band.label,
    plan: planSprints(basisModules(summary), velocity, sprints),
  };
}

export function EffortSummaryPanel({
  summary,
  estimate,
  teamSize,
  onTeamSize,
}: {
  summary: EffortSummaryData;
  estimate: RecomputedEstimate;
  teamSize: number;
  onTeamSize: (size: number) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const edited = teamSize !== summary.team_size;

  return (
    <div className="flex flex-col gap-3">
      <div className="border-blueprint-line/20 flex flex-col gap-4 rounded-2xl border bg-white/[0.025] px-6 py-5 backdrop-blur-md sm:flex-row sm:items-center sm:gap-8">
        <div className="flex flex-col">
          <span className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase">
            Sprints
          </span>
          <span
            aria-live="polite"
            className="text-blueprint-text font-display text-3xl font-bold tabular-nums"
          >
            {estimate.sprints}
          </span>
          <span className="text-blueprint-muted text-[11px]">
            {estimate.reliable
              ? `${estimate.lowSprints}–${estimate.highSprints} at ${estimate.bandLabel}`
              : "range unreliable at this confidence"}
          </span>
        </div>

        <Divider />

        <div className="flex flex-col gap-1">
          <label
            htmlFor="effort-team-size"
            className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase"
          >
            Team size
          </label>
          <div className="flex items-center gap-2">
            <Stepper
              label="Smaller team"
              onClick={() => onTeamSize(teamSize - 1)}
              disabled={teamSize <= 1}
            >
              <Minus size={13} />
            </Stepper>
            <input
              id="effort-team-size"
              type="number"
              min={1}
              max={SCOPING.maxTeamSize}
              value={teamSize}
              onChange={(e) => onTeamSize(Number(e.target.value))}
              className="border-blueprint-line/30 text-blueprint-text font-display w-16 rounded-lg border bg-transparent px-2 py-1 text-center text-2xl font-bold tabular-nums focus:border-[var(--color-blueprint-accent)]/60 focus:outline-none"
            />
            <Stepper
              label="Larger team"
              onClick={() => onTeamSize(teamSize + 1)}
              disabled={teamSize >= SCOPING.maxTeamSize}
            >
              <Plus size={13} />
            </Stepper>
          </div>
          <span className="text-blueprint-muted text-[11px]">
            {edited ? (
              <button
                type="button"
                onClick={() => onTeamSize(summary.team_size)}
                className="underline decoration-dotted underline-offset-2 hover:text-[var(--color-blueprint-accent)]"
              >
                reset to {summary.team_size}
              </button>
            ) : summary.team_size_stated ? (
              "as stated in the brief"
            ) : (
              `assumed — nobody said a team size`
            )}
          </span>
        </div>

        <Divider />

        <div className="flex flex-col">
          <span className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase">
            Confidence band
          </span>
          <span className="text-blueprint-text font-display text-lg font-bold">
            {summary.confidence_band}
          </span>
          <span className="text-blueprint-muted text-[11px]">
            {estimate.velocity} pts per 2-week sprint
          </span>
        </div>
      </div>

      <div className="border-blueprint-line/15 rounded-xl border bg-white/[0.015]">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="text-blueprint-muted hover:text-blueprint-text flex w-full items-center justify-between px-4 py-3 text-left text-xs"
        >
          How we estimated this
          <ChevronDown
            size={14}
            className={cn("transition-transform", open && "rotate-180")}
          />
        </button>
        {open && (
          <div className="border-blueprint-line/15 flex flex-col gap-4 border-t px-4 py-4 text-xs">
            <p className="text-blueprint-muted leading-relaxed">
              These numbers are calculated, not written by the AI. Module sizes come from
              the scope above; everything else is arithmetic you can check.
            </p>

            {summary.basis.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase">
                    <tr>
                      <th className="py-1.5 pr-4 font-medium">Module</th>
                      <th className="py-1.5 pr-4 font-medium">Size</th>
                      <th className="py-1.5 pr-4 font-medium">Base</th>
                      <th className="py-1.5 font-medium">Points</th>
                    </tr>
                  </thead>
                  <tbody className="text-blueprint-text">
                    {summary.basis.map((m, i) => (
                      <tr
                        key={`${m.name}-${i}`}
                        className="border-blueprint-line/10 border-t"
                      >
                        <td className="py-1.5 pr-4">{m.name}</td>
                        <td className="text-blueprint-muted py-1.5 pr-4 font-mono text-[11px]">
                          {m.size}
                        </td>
                        <td className="text-blueprint-muted py-1.5 pr-4 font-mono text-[11px] tabular-nums">
                          {pointsFor(m.size)}
                        </td>
                        <td className="py-1.5 font-mono text-[11px] tabular-nums">
                          {m.points}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <dl className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
              <Row
                term="Points per module"
                value={`SMALL ${SCOPING.modulePoints.SMALL} · MEDIUM ${SCOPING.modulePoints.MEDIUM} · LARGE ${SCOPING.modulePoints.LARGE}`}
              />
              <Row term="Domain multiplier" value={`×${summary.domain_multiplier}`} />
              <Row
                term="Total points"
                value={`${summary.total_points} (base × multiplier, summed)`}
              />
              <Row
                term="Velocity"
                value={`${estimate.velocity} points per 2-week sprint for a team of ${estimate.teamSize}`}
              />
              <Row
                term="Sprints"
                value={`ceil(${summary.total_points} ÷ ${estimate.velocity}) = ${estimate.sprints}`}
              />
              <Row
                term="Band"
                value={
                  estimate.reliable
                    ? `${estimate.bandLabel} → ${estimate.lowSprints}–${estimate.highSprints} sprints`
                    : `${summary.confidence_band} — raise the scope confidence before planning around this`
                }
              />
            </dl>

            {edited && (
              <p className="text-blueprint-muted leading-relaxed">
                Showing a team of {teamSize}. The document was generated for a team of{" "}
                {summary.team_size}; changing this number here does not save it.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ term, value }: { term: string; value: string }): React.ReactElement {
  return (
    <div className="flex flex-col">
      <dt className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase">
        {term}
      </dt>
      <dd className="text-blueprint-text">{value}</dd>
    </div>
  );
}

function Stepper({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="border-blueprint-line/30 text-blueprint-muted hover:text-blueprint-text inline-flex h-7 w-7 items-center justify-center rounded-lg border transition-colors disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Divider(): React.ReactElement {
  return <div className="bg-blueprint-line/20 hidden h-10 w-px sm:block" />;
}
