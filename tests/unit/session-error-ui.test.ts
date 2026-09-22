import { describe, expect, it } from "vitest";
import {
  RETRYABLE_ERROR_MESSAGE,
  sessionErrorNotice,
} from "@/components/chat/sessionError";
import { deriveSteps } from "@/components/chat/pipelineSteps";
import {
  deriveMessages,
  isAwaitingDescription,
  NEEDS_INPUT_PROMPT,
  ROUNDS_EXHAUSTED_PROMPT,
} from "@/components/chat/messageDerivation";
import { deriveSteps as _deriveSteps } from "@/components/chat/pipelineSteps";
import { SCOPING } from "@/lib/config/scoping";
import { makeRound, makeSession } from "../fixtures/llm";

const retryableError = {
  code: "LLM_ERROR",
  message: "Extraction model call failed",
  at: 1,
  retryable: true,
};

describe("sessionErrorNotice", () => {
  it("offers Retry with the reassuring message for a retryable failure", () => {
    const session = makeSession({ status: "error", last_error: retryableError });
    expect(sessionErrorNotice(session)).toEqual({
      message: "The AI service had a problem. Your answers are saved.",
      canRetry: true,
    });
    expect(RETRYABLE_ERROR_MESSAGE).toBe(
      "The AI service had a problem. Your answers are saved.",
    );
  });

  it("shows the server's message without Retry when retrying cannot help", () => {
    const session = makeSession({
      status: "error",
      last_error: {
        code: "BUDGET_EXCEEDED",
        message: "Aureon has reached today's AI usage limit. Please try again tomorrow.",
        at: 1,
        retryable: false,
      },
    });
    expect(sessionErrorNotice(session)).toEqual({
      message: "Aureon has reached today's AI usage limit. Please try again tomorrow.",
      canRetry: false,
    });
  });

  it("shows nothing for sessions that did not fail", () => {
    expect(sessionErrorNotice(null)).toBeNull();
    expect(sessionErrorNotice(makeSession({ status: "awaiting_answers" }))).toBeNull();
  });
});

describe("pipeline steps for a failed round", () => {
  it("marks Extract as failed when round 0 failed", () => {
    const steps = deriveSteps(
      makeSession({ status: "error", pipeline_stage: null, last_error: retryableError }),
      false,
    );
    expect(steps).toMatchObject({
      extract: "error",
      github: "pending",
      decide: "pending",
    });
  });

  it("marks the question step as failed when a later round failed", () => {
    const steps = deriveSteps(
      makeSession({
        status: "error",
        pipeline_stage: null,
        rounds: [makeRound()],
        last_error: retryableError,
      }),
      false,
    );
    expect(steps).toMatchObject({ extract: "done", score: "done", decide: "error" });
  });
});

describe("chat messages after a failed round", () => {
  it("still show the answers the user submitted", () => {
    const round = makeRound({
      questions: [
        {
          id: "0f0e0d0c-0b0a-4908-8706-050403020100",
          parameter_id: "P-02",
          question: "Who are the users?",
          options: ["Sales", "Support", "Other (describe)"],
          allow_custom: true,
          is_blocker: false,
        },
      ],
      answers: [
        {
          question_id: "0f0e0d0c-0b0a-4908-8706-050403020100",
          selected_options: ["Sales"],
          custom_text: null,
        },
      ],
    });
    const messages = deriveMessages(
      makeSession({ status: "error", pipeline_stage: null, rounds: [round] }),
    );
    expect(messages.some((m) => m.id === "answers-pending-0")).toBe(true);
  });
});

describe("needs_input (BUG-05)", () => {
  const needsInput = (rounds: number) =>
    makeSession({
      status: "needs_input",
      pipeline_stage: null,
      rounds: Array.from({ length: rounds }, (_, i) => makeRound({ round_number: i })),
    });

  it("unlocks the input box while a round is left to spend", () => {
    expect(isAwaitingDescription(needsInput(3))).toBe(true);
    expect(isAwaitingDescription(needsInput(SCOPING.maxTotalRounds))).toBe(false);
    expect(isAwaitingDescription(makeSession({ status: "blocker" }))).toBe(false);
    expect(isAwaitingDescription(null)).toBe(false);
  });

  it("asks for the description, or to start over once the rounds are used up", () => {
    expect(deriveMessages(needsInput(3)).at(-1)).toMatchObject({
      markdown: NEEDS_INPUT_PROMPT,
    });
    expect(deriveMessages(needsInput(SCOPING.maxTotalRounds)).at(-1)).toMatchObject({
      markdown: ROUNDS_EXHAUSTED_PROMPT,
    });
  });

  it("keeps the clarify step running, not done", () => {
    expect(_deriveSteps(needsInput(3), false)).toMatchObject({
      decide: "running",
      output: "pending",
    });
  });

  it("shows the description the user sent back", () => {
    const session = makeSession({
      status: "analyzing",
      rounds: [makeRound({ added_description: "It books haircuts for my salon." })],
    });
    expect(deriveMessages(session).map((m) => ("text" in m ? m.text : ""))).toContain(
      "It books haircuts for my salon.",
    );
  });
});
