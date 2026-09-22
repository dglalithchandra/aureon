import { describe, expect, it } from "vitest";
import {
  RETRYABLE_ERROR_MESSAGE,
  sessionErrorNotice,
} from "@/components/chat/sessionError";
import { deriveSteps } from "@/components/chat/pipelineSteps";
import { deriveMessages } from "@/components/chat/messageDerivation";
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
