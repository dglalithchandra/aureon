import { describe, expect, it } from "vitest";
import { SCOPING } from "@/lib/config/scoping";
import {
  buildScoringRubric,
  EXTRACTION_SYSTEM_PROMPT,
  submitExtractionTool,
} from "@/lib/llm/prompts/extract";

/** ARCH-01: the model reports a clarity read; the server computes the score. */

describe("the extraction prompt asks for a clarity read, not a score", () => {
  it("tells the model it does not compute the score", () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain(
      "You do NOT compute the project's confidence score",
    );
    expect(EXTRACTION_SYSTEM_PROMPT).toContain("CLARITY READ");
  });

  it("no longer asks the model to blend coverage and quality itself", () => {
    expect(EXTRACTION_SYSTEM_PROMPT).not.toContain("Blend ~");
    expect(EXTRACTION_SYSTEM_PROMPT).not.toContain("State multipliers:");
    expect(EXTRACTION_SYSTEM_PROMPT).not.toContain("Cap at");
  });

  it("does not tell the model to cap its own number", () => {
    const schema = JSON.stringify(submitExtractionTool.input_schema);
    expect(EXTRACTION_SYSTEM_PROMPT).not.toContain("Set confidence <=");
    expect(schema).not.toContain("confidence MUST be <=");
    expect(schema).toContain("do not try to compute that score");
  });

  it("embeds the generated rubric verbatim", () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain(buildScoringRubric());
  });

  it("names the configured caps so the model knows what the server does", () => {
    expect(buildScoringRubric()).toContain(
      `(${SCOPING.blockerCap} and ${SCOPING.criticalCap})`,
    );
    const changed = { ...SCOPING, blockerCap: 35, criticalCap: 60 };
    expect(buildScoringRubric(changed)).toContain("(35 and 60)");
  });

  it("still describes all 9 parameters and their states", () => {
    for (const p of SCOPING.parameters) {
      expect(EXTRACTION_SYSTEM_PROMPT).toContain(`${p.id} — ${p.name}`);
    }
    for (const state of Object.keys(SCOPING.stateMultipliers)) {
      expect(EXTRACTION_SYSTEM_PROMPT).toContain(state);
    }
  });
});
