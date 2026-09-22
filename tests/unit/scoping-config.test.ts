import { describe, expect, it } from "vitest";
import { parameterWeight, SCOPING, stateMultiplier } from "@/lib/config/scoping";
import {
  ExtractionResultStrictSchema,
  ParameterIdSchema,
} from "@/lib/schemas/extraction";
import { makeExtraction, makeParameters } from "../fixtures/llm";

describe("SCOPING config", () => {
  it("defines all 9 parameters in order with their tier and weight", () => {
    expect(SCOPING.parameters.map((p) => [p.id, p.tier, p.weight])).toEqual([
      ["P-01", "BLOCKER", 5],
      ["P-02", "HIGH", 4],
      ["P-03", "BLOCKER", 5],
      ["P-04", "HIGH", 3.5],
      ["P-05", "MED", 2.5],
      ["P-06", "MED", 2],
      ["P-07", "MED", 2],
      ["P-08", "MED", 2],
      ["P-09", "LOW", 1],
    ]);
    expect(SCOPING.parameters.map((p) => p.id)).toEqual(ParameterIdSchema.options);
    for (const p of SCOPING.parameters) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
    }
  });

  it("defines the state multipliers", () => {
    expect(SCOPING.stateMultipliers).toEqual({
      PRESENT: 1,
      PARTIAL_DEEP: 0.7,
      PARTIAL_THIN: 0.3,
      MISSING: 0,
    });
    expect(stateMultiplier("PARTIAL_DEEP")).toBe(0.7);
  });

  it("defines the round and cap rules", () => {
    expect({
      confidenceThreshold: SCOPING.confidenceThreshold,
      maxRounds: SCOPING.maxRounds,
      diminishingDelta: SCOPING.diminishingDelta,
      criticalCap: SCOPING.criticalCap,
      blockerCap: SCOPING.blockerCap,
      blockerMaxRounds: SCOPING.blockerMaxRounds,
      maxTotalRounds: SCOPING.maxTotalRounds,
    }).toEqual({
      confidenceThreshold: 70,
      maxRounds: 3,
      diminishingDelta: 4,
      criticalCap: 65,
      blockerCap: 40,
      blockerMaxRounds: 3,
      maxTotalRounds: 10,
    });
  });

  it("looks up weights by id", () => {
    expect(parameterWeight("P-04")).toBe(3.5);
    expect(parameterWeight("P-09")).toBe(1);
  });
});

describe("blocker invariant uses SCOPING.blockerCap", () => {
  const blocked = (confidence: number) =>
    makeExtraction({
      parameters: makeParameters({ "P-03": "MISSING" }),
      blocker: true,
      confidence,
    });

  it("accepts confidence exactly at the cap", () => {
    expect(ExtractionResultStrictSchema.safeParse(blocked(40)).success).toBe(true);
  });

  it("repairs confidence above the cap instead of rejecting it (ROB-01)", () => {
    const result = ExtractionResultStrictSchema.safeParse(blocked(55));
    expect(result.success).toBe(true);
    expect(result.data?.confidence).toBe(40);
  });

  it("forces blocker=true when P-01 or P-03 is MISSING", () => {
    const result = ExtractionResultStrictSchema.safeParse({
      ...blocked(30),
      blocker: false,
    });
    expect(result.data?.blocker).toBe(true);
    expect(result.data?.confidence).toBe(30);
  });

  it("leaves a non-blocked extraction untouched", () => {
    const ok = makeExtraction({ confidence: 88 });
    expect(ExtractionResultStrictSchema.safeParse(ok).data).toEqual(ok);
  });

  it("still rejects parameters out of order", () => {
    const params = makeParameters();
    const swapped = [params[1]!, params[0]!, ...params.slice(2)];
    const result = ExtractionResultStrictSchema.safeParse(
      makeExtraction({ parameters: swapped }),
    );
    expect(result.success).toBe(false);
  });
});

describe("the blocker fallback question", () => {
  it("is a plain-language question with 'Other (describe)' last", () => {
    expect(SCOPING.blockerFallback.question).toBe(
      "What problem does this software solve?",
    );
    expect(SCOPING.blockerFallback.options).toEqual([
      "Automate a manual process",
      "Replace an existing tool",
      "Connect two systems",
      "Sell a product or service to customers",
      "Give internal teams a better workflow",
      "Other (describe)",
    ]);
    // MCQQuestionSchema allows 3-8 options.
    expect(SCOPING.blockerFallback.options.length).toBeLessThanOrEqual(8);
  });
});
