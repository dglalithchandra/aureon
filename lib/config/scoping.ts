import type { z } from "zod";
import type { ParameterId, ParameterStateSchema } from "@/lib/schemas/extraction";

/**
 * Scoping configuration — the single source of truth for the 9 parameters,
 * their weights, the state multipliers and the round / exit rules.
 *
 * Read by the pipeline (exit rules, deterministic badge), the extraction
 * prompt (its scoring rubric is generated from this file) and the chat /
 * output UI. It must therefore stay free of server-only imports.
 */

type ParameterState = z.infer<typeof ParameterStateSchema>;

export type ParameterTier = "BLOCKER" | "HIGH" | "MED" | "LOW";

export interface ScopingParameter {
  readonly id: ParameterId;
  readonly name: string;
  readonly tier: ParameterTier;
  readonly weight: number;
  readonly description: string;
}

export interface ScopingConfig {
  /** Ordered P-01 … P-09. */
  readonly parameters: readonly ScopingParameter[];
  readonly stateMultipliers: Readonly<Record<ParameterState, number>>;
  /** Confidence at or above which clarification stops. */
  readonly confidenceThreshold: number;
  /** Clarification rounds after round 0 before the loop stops regardless. */
  readonly maxRounds: number;
  /** Two consecutive confidence gains below this count as diminishing returns. */
  readonly diminishingDelta: number;
  /** Confidence ceiling while a HIGH parameter (P-02, P-04) is MISSING. */
  readonly criticalCap: number;
  /** Confidence ceiling while a BLOCKER parameter (P-01, P-03) is MISSING. */
  readonly blockerCap: number;
  /** Blocker-only rounds allowed before asking the user to rewrite the brief. */
  readonly blockerMaxRounds: number;
  /**
   * Share of "coverage" (vs "quality") the extraction prompt tells the model
   * to blend into its confidence number. Guidance for the LLM only.
   */
  readonly promptCoverageBlend: number;
}

export const SCOPING: ScopingConfig = {
  parameters: [
    {
      id: "P-01",
      name: "Project Goal / Problem Statement",
      tier: "BLOCKER",
      weight: 5,
      description: "The core problem the software solves.",
    },
    {
      id: "P-02",
      name: "Target Users / Personas",
      tier: "HIGH",
      weight: 4,
      description: "Who uses the system and what roles they have.",
    },
    {
      id: "P-03",
      name: "Core Features / Functionality",
      tier: "BLOCKER",
      weight: 5,
      description: "What the system must actually do.",
    },
    {
      id: "P-04",
      name: "Technical Constraints / Stack Preferences",
      tier: "HIGH",
      weight: 3.5,
      description: "Required stack, platforms and existing systems.",
    },
    {
      id: "P-05",
      name: "Third-Party Integrations",
      tier: "MED",
      weight: 2.5,
      description: "External services such as payments, auth, messaging or CRMs.",
    },
    {
      id: "P-06",
      name: "Non-Functional Requirements",
      tier: "MED",
      weight: 2,
      description: "Performance, uptime, compliance, accessibility and retention.",
    },
    {
      id: "P-07",
      name: "Budget Range",
      tier: "MED",
      weight: 2,
      description: "The budget ceiling or range that constrains scope.",
    },
    {
      id: "P-08",
      name: "Delivery Timeline",
      tier: "MED",
      weight: 2,
      description: "When it must be live, MVP versus full launch.",
    },
    {
      id: "P-09",
      name: "Success Metrics / Definition of Done",
      tier: "LOW",
      weight: 1,
      description: "How success is measured: KPIs and acceptance criteria.",
    },
  ],
  stateMultipliers: {
    PRESENT: 1,
    PARTIAL_DEEP: 0.7,
    PARTIAL_THIN: 0.3,
    MISSING: 0,
  },
  confidenceThreshold: 70,
  maxRounds: 3,
  diminishingDelta: 4,
  criticalCap: 65,
  blockerCap: 40,
  blockerMaxRounds: 3,
  promptCoverageBlend: 0.7,
};

const WEIGHT_BY_ID = new Map<ParameterId, number>(
  SCOPING.parameters.map((p) => [p.id, p.weight]),
);

/** Weight of a parameter. Every ParameterId is configured above. */
export function parameterWeight(id: ParameterId): number {
  return WEIGHT_BY_ID.get(id) ?? 1;
}

/** Multiplier applied to a parameter's weight for a given state. */
export function stateMultiplier(state: ParameterState): number {
  return SCOPING.stateMultipliers[state];
}
