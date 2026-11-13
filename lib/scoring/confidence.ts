import { parameterWeight, SCOPING, stateMultiplier } from "@/lib/config/scoping";
import type { ExtractionResult, ParameterId } from "@/lib/schemas/extraction";

/**
 * The confidence score (ARCH-01).
 *
 * It used to be whatever number the model wrote down about its own work, so
 * the same brief could land either side of the 70-point exit threshold on
 * different runs. It is now computed here, on the server, from the validated
 * parameter states — a pure function of auditable inputs. The model still
 * contributes one component: how clearly it could read the brief.
 *
 *   coverage    weighted completeness of the 9 parameters
 *   quality     the model's clarity read ("AI clarity read" in the UI)
 *   consistency how closely those two agree (shown as a diagnostic)
 *   githubBonus corroboration from similar public repos, at most githubBonusMax
 *
 * Caps beat the blend: no scope with a missing goal or missing features can
 * look better than blockerCap, whatever the components say.
 */

export type ConfidenceCap = "blocker" | "critical" | "none";

export interface ConfidenceScore {
  /** What the product shows: rounded, capped. */
  score: number;
  /** The blend before the cap, rounded for display. */
  raw: number;
  coverage: number;
  quality: number;
  consistency: number;
  githubBonus: number;
  /** The ceiling that applied (100 when none did). */
  cap: number;
  capReason: ConfidenceCap;
}

/** A module that may carry a per-module confidence (arrives with GOAL-02). */
interface ScoredModule {
  github_validated: boolean;
  module_confidence?: number | null;
}

/** Parameters whose absence makes the scope unsafe to finalize. */
const CRITICAL_IDS: ParameterId[] = ["P-02"];

/** Weighted completeness of the 9 parameters, 0-100, unrounded. */
export function coverageOf(parameters: ExtractionResult["parameters"]): number {
  let weighted = 0;
  let total = 0;
  for (const p of parameters) {
    const weight = parameterWeight(p.id);
    total += weight;
    weighted += weight * stateMultiplier(p.state);
  }
  return total > 0 ? (weighted / total) * 100 : 0;
}

/**
 * Corroboration bonus: confidence in validated modules, scaled by the share
 * of all proposed modules that GitHub actually corroborated. A single strong
 * match therefore cannot grant the full bonus to a long, mostly unverified
 * module list.
 */
export function githubBonusOf(modules: ScoredModule[]): number {
  const scores = modules
    .filter((m) => m.github_validated)
    .map((m) => m.module_confidence)
    .filter((c): c is number => typeof c === "number");
  if (scores.length === 0) return 0;
  const average = scores.reduce((sum, c) => sum + c, 0) / scores.length;
  const validatedShare = scores.length / Math.max(1, modules.length);
  return Math.min(
    SCOPING.githubBonusMax,
    SCOPING.githubBonusMax * average * validatedShare,
  );
}

/** The ceiling this extraction cannot score above, and why. */
export function capFor(extraction: ExtractionResult): {
  cap: number;
  capReason: ConfidenceCap;
} {
  const isMissing = (id: ParameterId): boolean =>
    extraction.parameters.find((p) => p.id === id)?.state === "MISSING";

  if (extraction.blocker || isMissing("P-01") || isMissing("P-03")) {
    return { cap: SCOPING.blockerCap, capReason: "blocker" };
  }
  if (CRITICAL_IDS.some(isMissing)) {
    return { cap: SCOPING.criticalCap, capReason: "critical" };
  }
  return { cap: 100, capReason: "none" };
}

/** The score and every component behind it. Deterministic. */
export function computeConfidence(extraction: ExtractionResult): ConfidenceScore {
  const coverage = coverageOf(extraction.parameters);
  const quality = clamp(extraction.confidence);
  const consistency = 100 - Math.abs(coverage - quality);
  const githubBonus = githubBonusOf(extraction.modules);
  const w = SCOPING.scoreWeights;

  // Agreement is a penalty, not a free source of points. The previous formula
  // awarded 20 points when coverage and clarity were both zero merely because
  // the two weak signals agreed. This blend stays monotonic while making the
  // auditable parameter coverage the dominant signal.
  const disagreement = Math.abs(coverage - quality);
  const raw =
    w.coverage * coverage +
    w.quality * quality -
    SCOPING.disagreementPenalty * disagreement +
    githubBonus;
  const { cap, capReason } = capFor(extraction);

  return {
    score: Math.round(Math.min(cap, clamp(raw))),
    raw: Math.round(clamp(raw)),
    coverage: Math.round(coverage),
    quality: Math.round(quality),
    consistency: Math.round(consistency),
    githubBonus: Math.round(githubBonus),
    cap,
    capReason,
  };
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}
