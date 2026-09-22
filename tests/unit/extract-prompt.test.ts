import { describe, expect, it } from "vitest";
import { SCOPING } from "@/lib/config/scoping";
import {
  buildScoringRubric,
  EXTRACTION_SYSTEM_PROMPT,
  submitExtractionTool,
} from "@/lib/llm/prompts/extract";

describe("extraction prompt is generated from lib/config/scoping.ts", () => {
  it.each(SCOPING.parameters.map((p) => [p.id, p.weight] as const))(
    "states the configured weight for %s (%d)",
    (id, weight) => {
      expect(EXTRACTION_SYSTEM_PROMPT).toContain(`${id}: ${weight}`);
    },
  );

  it("lists every weight in parameter order on one line", () => {
    const line = SCOPING.parameters.map((p) => `${p.id}: ${p.weight}`).join(", ");
    expect(line).toBe(
      "P-01: 5, P-02: 4, P-03: 5, P-04: 3.5, P-05: 2.5, P-06: 2, P-07: 2, P-08: 2, P-09: 1",
    );
    expect(EXTRACTION_SYSTEM_PROMPT).toContain(line);
  });

  it("states the configured state multipliers", () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain(
      "State multipliers: PRESENT=1.0, PARTIAL_DEEP=0.7, PARTIAL_THIN=0.3, MISSING=0.0",
    );
  });

  it("uses the configured blocker cap in the prompt and the tool schema", () => {
    const cap = SCOPING.blockerCap;
    expect(EXTRACTION_SYSTEM_PROMPT).toContain(
      `Set confidence <= ${cap} (no exceptions)`,
    );
    expect(EXTRACTION_SYSTEM_PROMPT).toContain(`Cap at ${cap} if blocker.`);
    expect(JSON.stringify(submitExtractionTool.input_schema)).toContain(
      `confidence MUST be <= ${cap}`,
    );
  });

  it("embeds the generated rubric verbatim", () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain(buildScoringRubric());
  });

  it("follows the config when a weight or cap changes", () => {
    const changed = {
      ...SCOPING,
      blockerCap: 35,
      promptCoverageBlend: 0.6,
      parameters: SCOPING.parameters.map((p) =>
        p.id === "P-09" ? { ...p, weight: 1.5 } : p,
      ),
    };
    const rubric = buildScoringRubric(changed);
    expect(rubric).toContain("P-09: 1.5");
    expect(rubric).toContain("Blend ~60% coverage + 40% quality.");
    expect(rubric).toContain("Cap at 35 if blocker.");
  });
});
