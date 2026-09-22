import { describe, expect, it } from "vitest";
import { shouldExit } from "@/lib/pipeline/orchestrator";
import { makeExtraction, makeRound, makeSession } from "../fixtures/llm";

// Literal values on purpose: these tests pin the product rules (exit at 70,
// max 3 clarification rounds, diminishing delta 4) rather than re-reading
// SESSION_CONFIG, so changing a constant must fail a test.

function sessionWithConfidences(confidences: number[]) {
  return makeSession({
    rounds: confidences.map((confidence, round_number) =>
      makeRound({ round_number, extraction: makeExtraction({ confidence }) }),
    ),
  });
}

describe("shouldExit: confidence threshold", () => {
  it("exits once confidence reaches 70", () => {
    expect(shouldExit(makeSession(), makeExtraction({ confidence: 70 }))).toBe(true);
  });

  it("exits above the threshold", () => {
    expect(shouldExit(makeSession(), makeExtraction({ confidence: 75 }))).toBe(true);
  });

  it("keeps asking just below the threshold", () => {
    expect(shouldExit(makeSession(), makeExtraction({ confidence: 69 }))).toBe(false);
  });
});

describe("shouldExit: max rounds", () => {
  it("exits after 3 completed rounds even at low confidence", () => {
    const session = sessionWithConfidences([10, 30, 50]);
    expect(shouldExit(session, makeExtraction({ confidence: 60 }))).toBe(true);
  });

  it("continues with 2 completed rounds when confidence is still rising", () => {
    const session = sessionWithConfidences([10, 30]);
    expect(shouldExit(session, makeExtraction({ confidence: 50 }))).toBe(false);
  });
});

describe("shouldExit: diminishing returns", () => {
  it("exits when the last two deltas are both below 4", () => {
    const session = sessionWithConfidences([40, 43]); // +3
    expect(shouldExit(session, makeExtraction({ confidence: 46 }))).toBe(true); // +3
  });

  it("continues when the latest delta is exactly 4", () => {
    const session = sessionWithConfidences([40, 43]);
    expect(shouldExit(session, makeExtraction({ confidence: 47 }))).toBe(false);
  });

  it("continues when the earlier delta was large", () => {
    const session = sessionWithConfidences([30, 45]); // +15
    expect(shouldExit(session, makeExtraction({ confidence: 47 }))).toBe(false); // +2
  });

  it("needs two previous rounds before judging the trend", () => {
    const session = sessionWithConfidences([44]);
    expect(shouldExit(session, makeExtraction({ confidence: 45 }))).toBe(false);
  });

  it("treats a falling score as diminishing", () => {
    const session = sessionWithConfidences([50, 48]);
    expect(shouldExit(session, makeExtraction({ confidence: 47 }))).toBe(true);
  });
});

describe("shouldExit: the session round limit (BUG-05)", () => {
  it("exits when no further round would fit in the session", () => {
    const session = sessionWithConfidences(Array(9).fill(50));
    expect(session.rounds).toHaveLength(9);
    // A 10th round is the last one SessionSchema can store.
    expect(shouldExit(session, makeExtraction({ confidence: 50 }))).toBe(true);
  });
});
