import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateQuestions } from "@/lib/pipeline/mcq";
import { LLMError } from "@/lib/errors";
import { startMockAnthropic, type MockAnthropic } from "../mocks/mock-anthropic";
import { makeExtraction, makeParameters, makeQuestionsPayload } from "../fixtures/llm";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let mock: MockAnthropic;

beforeAll(async () => {
  mock = await startMockAnthropic();
  process.env.ANTHROPIC_BASE_URL = mock.url;
});

afterAll(async () => {
  await mock.close();
});

beforeEach(() => {
  mock.reset();
});

describe("generateQuestions: askedBefore filtering", () => {
  it("skips the LLM entirely when every open parameter was already asked", async () => {
    const extraction = makeExtraction({
      parameters: makeParameters({
        "P-02": "PRESENT",
        "P-04": "PRESENT",
        "P-05": "PRESENT",
        "P-06": "PRESENT",
        "P-07": "MISSING",
        "P-08": "PRESENT",
        "P-09": "PRESENT",
      }),
    });

    const questions = await generateQuestions({
      extraction,
      askedBefore: ["P-07"],
      roundNumber: 1,
    });

    expect(questions).toEqual([]);
    expect(mock.calls).toHaveLength(0);
  });

  it("drops questions for parameters that were asked in earlier rounds", async () => {
    mock.override(
      "generate_clarification_questions",
      makeQuestionsPayload(["P-02", "P-07", "P-08"]),
    );

    const questions = await generateQuestions({
      extraction: makeExtraction(),
      askedBefore: ["P-02"],
      roundNumber: 1,
    });

    expect(questions.map((q) => q.parameter_id)).toEqual(["P-07", "P-08"]);
    expect(mock.callsFor("generate_clarification_questions")).toHaveLength(1);
    expect(mock.calls[0]?.userText).toContain("<asked_before>P-02</asked_before>");
  });

  it("assigns server-side UUIDs and always offers an 'Other' option", async () => {
    const questions = await generateQuestions({
      extraction: makeExtraction(),
      askedBefore: [],
      roundNumber: 0,
    });

    expect(questions).toHaveLength(3);
    for (const q of questions) {
      expect(q.id).toMatch(UUID_V4);
      expect(q.allow_custom).toBe(true);
      expect(q.options.at(-1)).toBe("Other (describe)");
    }
    expect(new Set(questions.map((q) => q.id)).size).toBe(3);
  });
});

describe("generateQuestions: blocker mode", () => {
  const blockerExtraction = () =>
    makeExtraction({
      parameters: makeParameters({ "P-01": "MISSING" }),
      blocker: true,
      confidence: 30,
    });

  it("returns exactly one question, for the MISSING blocker parameter", async () => {
    mock.override(
      "generate_clarification_questions",
      makeQuestionsPayload(["P-02", "P-01", "P-03"]),
    );

    const questions = await generateQuestions({
      extraction: blockerExtraction(),
      askedBefore: [],
      roundNumber: 0,
    });

    expect(questions).toHaveLength(1);
    expect(questions[0]?.parameter_id).toBe("P-01");
    expect(questions[0]?.is_blocker).toBe(true);
  });

  it("ignores a model's is_blocker flag on a parameter that is not MISSING", async () => {
    // P-03 is PRESENT in this extraction, so it cannot be the blocker.
    const payload = makeQuestionsPayload(["P-03"]);
    payload.questions[0]!.is_blocker = true;
    mock.override("generate_clarification_questions", payload);

    const questions = await generateQuestions({
      extraction: blockerExtraction(),
      askedBefore: [],
      roundNumber: 0,
    });

    expect(questions).toEqual([]);
  });

  it("outside blocker mode keeps the model's is_blocker flag and up to 3 questions", async () => {
    const payload = makeQuestionsPayload(["P-02", "P-07", "P-08"]);
    payload.questions[1]!.is_blocker = true;
    mock.override("generate_clarification_questions", payload);

    const questions = await generateQuestions({
      extraction: makeExtraction(),
      askedBefore: [],
      roundNumber: 0,
    });

    expect(questions.map((q) => q.is_blocker)).toEqual([false, true, false]);
  });
});

describe("generateQuestions: model failures", () => {
  it("returns [] when the tool output fails validation", async () => {
    mock.override("generate_clarification_questions", { questions: [] });

    const questions = await generateQuestions({
      extraction: makeExtraction(),
      askedBefore: [],
      roundNumber: 0,
    });

    expect(questions).toEqual([]);
  });

  it("throws LLMError when the API stays overloaded", async () => {
    mock.failNext(3); // first attempt + the SDK's 2 retries

    await expect(
      generateQuestions({
        extraction: makeExtraction(),
        askedBefore: [],
        roundNumber: 0,
      }),
    ).rejects.toBeInstanceOf(LLMError);
    expect(mock.calls).toHaveLength(3);
  });
});
