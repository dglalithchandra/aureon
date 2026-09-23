import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSession, runRound, submitAnswers } from "@/lib/pipeline/orchestrator";
import { generateOutput } from "@/lib/pipeline/finalize";
import { LLMError, ValidationError } from "@/lib/errors";
import { SessionSchema, type MCQAnswer, type PipelineStage } from "@/lib/schemas/mcq";
import { FinalOutputSchema } from "@/lib/schemas/output";
import { startMockAnthropic, type MockAnthropic } from "../mocks/mock-anthropic";
import { makeExtraction, makeParameters } from "../fixtures/llm";

/**
 * End-to-end pipeline against the in-process mock Anthropic server.
 * No paid API and no GitHub: the default extraction produces zero search
 * queries, and tests/setup.ts blocks every non-loopback fetch.
 */

const RAW_INPUT =
  "We need an internal tool so our account managers can manage client accounts. " +
  "Staff log in, admins manage roles.";

const NO_GITHUB_QUERY = {
  matches: [],
  module_frequency: {},
  module_repos: {},
  query_used: "",
  variants: [],
};

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

describe("scoping pipeline (mock LLM)", () => {
  it("runs create → round 0 → answers → round 1 → final output", async () => {
    // ── create ──────────────────────────────────────────────────
    let session = createSession(RAW_INPUT);
    expect(session.status).toBe("analyzing");
    expect(SessionSchema.safeParse(session).success).toBe(true);

    // ── round 0 ─────────────────────────────────────────────────
    const stages: Array<PipelineStage | null> = [];
    session = await runRound(session, async (s) => {
      stages.push(s.pipeline_stage);
    });

    expect(stages).toEqual(["extracting", "github", "scoring", "clarifying"]);
    expect(session.status).toBe("awaiting_answers");
    expect(session.pipeline_stage).toBeNull();
    // Computed from the parameter states, not the model's number (ARCH-01).
    expect(session.current_confidence).toBe(55);
    expect(session.rounds).toHaveLength(1);

    const round0 = session.rounds[0]!;
    expect(round0.github_enrichment).toEqual(NO_GITHUB_QUERY);
    expect(round0.questions.map((q) => q.parameter_id)).toEqual(["P-02", "P-07", "P-08"]);
    expect(mock.calls.map((c) => c.tool)).toEqual([
      "submit_extraction",
      "generate_clarification_questions",
    ]);
    expect(mock.calls[0]?.userText).toContain("account managers");

    // ── answers → round 1 ───────────────────────────────────────
    mock.enqueue(
      "submit_extraction",
      makeExtraction({
        confidence: 70,
        parameters: makeParameters({
          "P-02": "PRESENT",
          "P-04": "PRESENT",
          "P-07": "PARTIAL_DEEP",
          "P-08": "PRESENT",
        }),
      }),
    );
    const answers: MCQAnswer[] = round0.questions.map((q, i) => ({
      question_id: q.id,
      selected_options: [q.options[0]!],
      custom_text: i === 0 ? "Field sales managers in three regions" : null,
    }));

    session = await submitAnswers(session, answers);

    expect(session.status).toBe("ready");
    expect(session.current_confidence).toBe(79);
    expect(session.rounds).toHaveLength(2);
    expect(session.rounds[0]!.answers).toEqual(answers);
    expect(session.raw_input).toBe(RAW_INPUT);
    expect(session.enriched_input).toContain(
      "Custom: Field sales managers in three regions",
    );
    // Same domain → round 0's enrichment is reused instead of searching again.
    expect(session.rounds[1]!.github_enrichment).toEqual(round0.github_enrichment);
    expect(SessionSchema.safeParse(session).success).toBe(true);

    const extractionCalls = mock.callsFor("submit_extraction");
    expect(extractionCalls).toHaveLength(2);
    expect(extractionCalls[1]!.userText).toContain("Parameter: P-02");
    expect(extractionCalls[1]!.userText).toContain(
      "Custom: Field sales managers in three regions",
    );
    // The score (79) is past the threshold, so no further questions were generated.
    expect(mock.callsFor("generate_clarification_questions")).toHaveLength(1);

    // ── final output ────────────────────────────────────────────
    const output = await generateOutput(session);

    expect(FinalOutputSchema.safeParse(output).success).toBe(true);
    // The LLM fixture says score 12; the server must use the computed value.
    expect(output.client.confidence_badge).toEqual({
      score: 79,
      breakdown: {
        coverage: 80,
        ai_clarity: 70,
        consistency: 90,
        github_bonus: 0,
        cap_applied: 100,
      },
    });
    // The band comes from the computed score, not from the model (step 10).
    expect(output.engineer.effort_summary.confidence_band).toBe("±35%");
    expect(mock.callsFor("submit_client_view")).toHaveLength(1);
    expect(mock.callsFor("submit_engineer_view")).toHaveLength(1);
    expect(mock.callsFor("submit_client_view")[0]?.userText).toContain(
      "current_confidence: 79",
    );
    expect(mock.calls).toHaveLength(5);
  });

  it("goes straight to ready when round 0 is already confident", async () => {
    mock.override(
      "submit_extraction",
      makeExtraction({
        confidence: 72,
        parameters: makeParameters({
          "P-02": "PRESENT",
          "P-04": "PRESENT",
          "P-05": "PRESENT",
          "P-06": "PRESENT",
          "P-07": "PRESENT",
          "P-08": "PRESENT",
          "P-09": "PRESENT",
        }),
      }),
    );

    const session = await runRound(createSession(RAW_INPUT));

    expect(session.status).toBe("ready");
    expect(session.rounds[0]!.questions).toEqual([]);
    expect(mock.callsFor("generate_clarification_questions")).toHaveLength(0);
  });

  it("rejects answers to a question that was not asked", async () => {
    const session = await runRound(createSession(RAW_INPUT));
    const bogus: MCQAnswer = {
      question_id: "00000000-0000-4000-8000-000000000000",
      selected_options: ["Option A"],
      custom_text: null,
    };

    await expect(submitAnswers(session, [bogus])).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("scoping pipeline: LLM failures", () => {
  it("rides out transient 529s through the SDK's retries", async () => {
    mock.failNext(2);

    const session = await runRound(createSession(RAW_INPUT));

    expect(session.status).toBe("awaiting_answers");
    expect(mock.callsFor("submit_extraction")).toHaveLength(3);
  });

  it("surfaces an LLMError when the model stays overloaded", async () => {
    mock.failNext(3);

    await expect(runRound(createSession(RAW_INPUT))).rejects.toBeInstanceOf(LLMError);
    expect(mock.calls).toHaveLength(3);
  });

  it("repairs an extraction that breaks the blocker invariant and caps the score", async () => {
    // P-01 MISSING forces blocker=true; the score is capped at 40 (ARCH-01),
    // while the model's clarity read is kept as it was.
    mock.override(
      "submit_extraction",
      makeExtraction({
        parameters: makeParameters({ "P-01": "MISSING" }),
        blocker: false,
        confidence: 55,
      }),
    );

    const session = await runRound(createSession(RAW_INPUT));

    expect(session.status).not.toBe("error");
    expect(session.rounds[0]!.extraction).toMatchObject({
      blocker: true,
      confidence: 55,
    });
    expect(session.current_confidence).toBe(40);
    expect(mock.callsFor("submit_extraction")).toHaveLength(1); // repaired, not retried
  });
});
