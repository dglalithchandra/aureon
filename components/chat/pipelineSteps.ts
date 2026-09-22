import type { Session } from "@/lib/schemas/mcq";

/**
 * Step states for both chat pipeline views: the desktop roadmap
 * (PipelineRoadmap) and the mobile / sidebar panel (PipelinePanel).
 */

export type StepState = "pending" | "running" | "done" | "error";

export const PIPELINE_STEP_IDS = [
  "extract",
  "github",
  "score",
  "decide",
  "output",
] as const;
export type PipelineStepId = (typeof PIPELINE_STEP_IDS)[number];
export type PipelineStepStates = Record<PipelineStepId, StepState>;

/**
 * While the server is analyzing, `session.pipeline_stage` (persisted before
 * each expensive step) decides which step is running — on round 0 and on
 * every later round. Once a round has landed, `session.status` decides the
 * last two steps.
 */
export function deriveSteps(
  session: Session | null,
  isAnalyzing: boolean,
): PipelineStepStates {
  const steps: PipelineStepStates = {
    extract: "pending",
    github: "pending",
    score: "pending",
    decide: "pending",
    output: "pending",
  };
  const status = session?.status ?? "analyzing";

  if (!session || status === "analyzing") {
    switch (session?.pipeline_stage) {
      case "github":
        steps.extract = "done";
        steps.github = "running";
        break;
      case "scoring":
        steps.extract = "done";
        steps.github = "done";
        steps.score = "running";
        break;
      case "clarifying":
        steps.extract = "done";
        steps.github = "done";
        steps.score = "done";
        steps.decide = "running";
        break;
      default:
        // "extracting", or no stage reported yet.
        if (isAnalyzing) steps.extract = "running";
    }
    return steps;
  }

  if (status === "error" && session.rounds.length === 0) {
    // Round 0 failed: nothing landed yet.
    steps.extract = "error";
    return steps;
  }

  steps.extract = "done";
  steps.github = "done";
  steps.score = "done";
  if (status === "error") {
    // A later round failed after the previous one landed.
    steps.decide = "error";
  } else if (status === "blocker" || status === "awaiting_answers") {
    steps.decide = "running";
  } else if (status === "ready") {
    steps.decide = "done";
    steps.output = "running";
  } else if (status === "finalized") {
    steps.decide = "done";
    steps.output = "done";
  }
  return steps;
}
