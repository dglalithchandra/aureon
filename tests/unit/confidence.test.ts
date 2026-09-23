import { describe, expect, it } from "vitest";
import { computeConfidence } from "@/lib/scoring/confidence";
import { SCOPING } from "@/lib/config/scoping";
import type { ParameterId, ParameterState } from "@/lib/schemas/extraction";
import { makeExtraction, makeParameters } from "../fixtures/llm";

/** ARCH-01: the score is computed from the parameter states, not claimed. */

type States = Partial<Record<ParameterId, ParameterState>>;

const ALL_IDS: ParameterId[] = [
  "P-01",
  "P-02",
  "P-03",
  "P-04",
  "P-05",
  "P-06",
  "P-07",
  "P-08",
  "P-09",
];
const STATES: ParameterState[] = ["MISSING", "PARTIAL_THIN", "PARTIAL_DEEP", "PRESENT"];

const everything = (state: ParameterState): States =>
  Object.fromEntries(ALL_IDS.map((id) => [id, state])) as States;

function score(states: States, clarity: number, blocker = false) {
  return computeConfidence(
    makeExtraction({ parameters: makeParameters(states), confidence: clarity, blocker }),
  );
}

describe("the components", () => {
  it("is 100 only when everything is present and the brief reads perfectly", () => {
    expect(score(everything("PRESENT"), 100)).toMatchObject({
      score: 100,
      coverage: 100,
      quality: 100,
      consistency: 100,
      githubBonus: 0,
      cap: 100,
      capReason: "none",
    });
  });

  it("weights coverage by parameter, so the goal counts for more than metrics", () => {
    const withGoal = score({ ...everything("MISSING"), "P-01": "PRESENT" }, 50).coverage;
    const withMetrics = score(
      { ...everything("MISSING"), "P-09": "PRESENT" },
      50,
    ).coverage;
    expect(withGoal).toBeGreaterThan(withMetrics);
  });

  it("rewards coverage and the clarity read agreeing", () => {
    // Coverage 100 with a clarity read of 50 is an inconsistent pair.
    const agreeing = score(everything("PRESENT"), 100).consistency;
    const disagreeing = score(everything("PRESENT"), 50).consistency;
    expect(agreeing).toBe(100);
    expect(disagreeing).toBe(50);
  });

  it("has no GitHub bonus until modules carry a confidence", () => {
    expect(score(everything("PRESENT"), 90).githubBonus).toBe(0);
  });
});

describe("caps", () => {
  it.each([
    [
      "a missing goal (P-01)",
      { "P-01": "MISSING" } as States,
      SCOPING.blockerCap,
      "blocker",
    ],
    [
      "missing features (P-03)",
      { "P-03": "MISSING" } as States,
      SCOPING.blockerCap,
      "blocker",
    ],
    [
      "missing users (P-02)",
      { "P-02": "MISSING" } as States,
      SCOPING.criticalCap,
      "critical",
    ],
    [
      "missing tech constraints (P-04)",
      { "P-04": "MISSING" } as States,
      SCOPING.criticalCap,
      "critical",
    ],
    ["nothing missing", {} as States, 100, "none"],
  ])("caps at %s", (_label, missing, cap, reason) => {
    const result = score({ ...everything("PRESENT"), ...missing }, 100);
    expect(result.cap).toBe(cap);
    expect(result.capReason).toBe(reason);
    expect(result.score).toBeLessThanOrEqual(cap);
  });

  it("applies the blocker cap even when the model forgot to set the flag", () => {
    const result = score({ ...everything("PRESENT"), "P-01": "MISSING" }, 100, false);
    expect(result.score).toBe(SCOPING.blockerCap);
  });

  it("keeps the raw blend visible above the cap", () => {
    const result = score({ ...everything("PRESENT"), "P-01": "MISSING" }, 90);
    expect(result.raw).toBeGreaterThan(result.score);
    expect(result.score).toBe(SCOPING.blockerCap);
  });

  it("the blocker cap wins over the critical cap", () => {
    const result = score(
      { ...everything("PRESENT"), "P-01": "MISSING", "P-02": "MISSING" },
      100,
    );
    expect(result.cap).toBe(SCOPING.blockerCap);
  });
});

describe("rounding", () => {
  it.each([
    // coverage 100, so raw = 50 + 0.3·clarity + 0.2·clarity.
    [100, 100],
    [91, 96], // 50 + 27.3 + 18.2 = 95.5, and a half rounds up
    [90, 95],
    [89, 95], // 50 + 26.7 + 17.8 = 94.5, likewise
    [88, 94], // 50 + 26.4 + 17.6 = 94.0
    [40, 70],
    [0, 50],
  ])("clarity %d gives %d", (clarity, expected) => {
    expect(score(everything("PRESENT"), clarity).score).toBe(expected);
  });

  it("always returns whole numbers in range", () => {
    for (const state of STATES) {
      for (const clarity of [0, 1, 33, 67, 99, 100]) {
        const result = score(everything(state), clarity);
        expect(Number.isInteger(result.score)).toBe(true);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("monotonicity: improving a parameter never lowers the score", () => {
  it.each(ALL_IDS)("holds for %s", (id) => {
    let previous = -1;
    for (const state of STATES) {
      // Everything else present, so no cap moves underneath us.
      const result = score({ ...everything("PRESENT"), [id]: state }, 70).score;
      expect(result).toBeGreaterThanOrEqual(previous);
      previous = result;
    }
  });

  it("holds when improving from a blocker, cap and all", () => {
    const blocked = score({ ...everything("MISSING"), "P-01": "MISSING" }, 50).score;
    const goalOnly = score({ ...everything("MISSING"), "P-01": "PRESENT" }, 50).score;
    const goalAndFeatures = score(
      { ...everything("MISSING"), "P-01": "PRESENT", "P-03": "PRESENT" },
      50,
    ).score;
    const everythingElse = score(everything("PRESENT"), 50).score;
    expect(blocked).toBeLessThanOrEqual(goalOnly);
    expect(goalOnly).toBeLessThanOrEqual(goalAndFeatures);
    expect(goalAndFeatures).toBeLessThanOrEqual(everythingElse);
  });
});

describe("determinism", () => {
  it("gives the same score for the same states every time", () => {
    const states = { "P-02": "PARTIAL_THIN", "P-05": "MISSING" } as States;
    const runs = Array.from({ length: 20 }, () => score(states, 63).score);
    expect(new Set(runs).size).toBe(1);
  });

  it("does not depend on anything but states, clarity and modules", () => {
    const a = makeExtraction({
      parameters: makeParameters({ "P-02": "PARTIAL_DEEP" }),
      confidence: 55,
      domain: "SaaS",
      assumptions: ["one"],
      open_questions: ["two?"],
    });
    const b = makeExtraction({
      parameters: makeParameters({ "P-02": "PARTIAL_DEEP" }),
      confidence: 55,
      domain: "Marketplace",
      assumptions: [],
      open_questions: [],
    });
    expect(computeConfidence(a).score).toBe(computeConfidence(b).score);
  });
});
