import { describe, expect, it } from "vitest";
import { shouldExit } from "@/lib/pipeline/orchestrator";
import { computeConfidence } from "@/lib/scoring/confidence";
import type { ExtractionResult, ParameterId } from "@/lib/schemas/extraction";
import type { Session } from "@/lib/schemas/mcq";
import { makeExtraction, makeParameters, makeRound, makeSession } from "../fixtures/llm";

// The exit rules are pinned to literal numbers on purpose (exit at 70, max 3
// clarification rounds, diminishing delta 4), so changing a constant must
// fail a test. Since ARCH-01 the numbers are computed scores, not the model's
// self-grade, so the fixtures here vary parameter states.

type States = Parameters<typeof makeParameters>[0];

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

const allPresent = (): States =>
  Object.fromEntries(ALL_IDS.map((id) => [id, "PRESENT"])) as States;

function extraction(states: States, confidence: number): ExtractionResult {
  return makeExtraction({ parameters: makeParameters(states), confidence });
}

function sessionOf(...extractions: ExtractionResult[]): Session {
  return makeSession({
    rounds: extractions.map((e, round_number) =>
      makeRound({ round_number, extraction: e }),
    ),
  });
}

/** A thin brief: goal and features present, most else missing. */
const THIN = extraction(
  { "P-02": "PARTIAL_THIN", "P-04": "PARTIAL_THIN", "P-05": "MISSING" },
  45,
);
/** The same brief with one low-weight parameter filled in. */
const THIN_PLUS = extraction(
  {
    "P-02": "PARTIAL_THIN",
    "P-04": "PARTIAL_THIN",
    "P-05": "MISSING",
    "P-09": "PRESENT",
  },
  45,
);
/** And one more small upgrade on top of that. */
const THIN_PLUS_PLUS = extraction(
  {
    "P-02": "PARTIAL_THIN",
    "P-04": "PARTIAL_THIN",
    "P-05": "MISSING",
    "P-09": "PRESENT",
    "P-07": "PARTIAL_THIN",
  },
  45,
);
/** A big jump from THIN: users and integrations answered properly. */
const THICK = extraction(
  { "P-02": "PRESENT", "P-04": "PARTIAL_THIN", "P-05": "PRESENT" },
  45,
);

describe("the fixtures score where these tests assume", () => {
  it.each([
    [THIN, 56],
    [THIN_PLUS, 57],
    [THIN_PLUS_PLUS, 58],
    [THICK, 62],
    [extraction(allPresent(), 40), 70], // exactly the threshold
    [extraction(allPresent(), 35), 68],
  ])("scores %#", (ex, expected) => {
    expect(computeConfidence(ex).score).toBe(expected);
  });
});

describe("shouldExit: confidence threshold", () => {
  it("exits once the computed score reaches 70", () => {
    expect(shouldExit(makeSession(), extraction(allPresent(), 40))).toBe(true);
  });

  it("exits well above the threshold", () => {
    expect(shouldExit(makeSession(), extraction(allPresent(), 90))).toBe(true);
  });

  it("keeps asking just below the threshold", () => {
    expect(shouldExit(makeSession(), extraction(allPresent(), 35))).toBe(false);
  });

  it("ignores a model that claims 100 on a thin brief", () => {
    // The old behaviour: the model's number was the score.
    const bluffing = extraction({ "P-02": "MISSING", "P-05": "MISSING" }, 100);
    expect(bluffing.confidence).toBe(100);
    expect(shouldExit(makeSession(), bluffing)).toBe(false);
  });
});

describe("shouldExit: max rounds", () => {
  it("exits after 3 completed rounds even at a low score", () => {
    const session = sessionOf(THIN, THIN, THIN);
    expect(shouldExit(session, THIN)).toBe(true);
  });

  it("continues with 2 completed rounds when the score is still rising", () => {
    const session = sessionOf(THIN, THIN_PLUS);
    expect(shouldExit(session, THICK)).toBe(false);
  });
});

describe("shouldExit: diminishing returns", () => {
  it("exits when the last two gains are both below 4 points", () => {
    const session = sessionOf(THIN, THIN_PLUS); // 56 → 57
    expect(shouldExit(session, THIN_PLUS_PLUS)).toBe(true); // 57 → 58
  });

  it("continues when the earlier gain was large", () => {
    const session = sessionOf(THIN, THICK); // 56 → 62
    expect(shouldExit(session, THICK)).toBe(false); // 62 → 62
  });

  it("needs two previous rounds before judging the trend", () => {
    expect(shouldExit(sessionOf(THIN), THIN_PLUS)).toBe(false);
  });

  it("treats a falling score as diminishing", () => {
    const session = sessionOf(THIN_PLUS_PLUS, THIN_PLUS); // 58 → 57
    expect(shouldExit(session, THIN)).toBe(true); // 57 → 56
  });
});

describe("shouldExit: the session round limit (BUG-05)", () => {
  it("exits when no further round would fit in the session", () => {
    const session = sessionOf(...Array<ExtractionResult>(9).fill(THIN));
    expect(session.rounds).toHaveLength(9);
    // A 10th round is the last one SessionSchema can store.
    expect(shouldExit(session, THIN)).toBe(true);
  });
});
