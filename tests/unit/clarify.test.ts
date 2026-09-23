import { describe, expect, it } from "vitest";
import { applyClarification } from "@/lib/pipeline/orchestrator";
import { canGenerateAnyway } from "@/components/chat/polling";
import { SCOPING } from "@/lib/config/scoping";
import type { Session } from "@/lib/schemas/mcq";
import { makeRound, makeSession } from "../fixtures/llm";

/**
 * UX-02: answering an open item from the output page, and generating a scope
 * before the questions are finished.
 */

function finalized(overrides: Partial<Session> = {}): Session {
  return makeSession({
    status: "finalized",
    pipeline_stage: null,
    rounds: [makeRound({ round_number: 0 })],
    ...overrides,
  });
}

describe("applyClarification", () => {
  it("sends a finished scope back through the pipeline", () => {
    const next = applyClarification(finalized(), "Which payment provider?", "Stripe.");

    expect(next.status).toBe("analyzing");
    expect(next.pipeline_stage).toBe("extracting");
    expect(next.rounds[0]?.added_description).toBe("Which payment provider?\nStripe.");
    expect(next.enriched_input).toContain("Stripe.");
  });

  it("keeps the document that is already there, so the page still has one", () => {
    const session = finalized({
      final_output: null,
      current_confidence: 64,
    });
    const next = applyClarification(session, "Budget?", "40,000 dollars.");

    expect(next.final_output).toBe(session.final_output);
    expect(next.current_confidence).toBe(64);
    expect(next.last_error).toBeNull();
  });

  it("accepts a session that is ready but not yet generated", () => {
    expect(() =>
      applyClarification(finalized({ status: "ready" }), "", "More detail."),
    ).not.toThrow();
  });

  it("appends to an answer already recorded on the round", () => {
    const session = finalized({
      rounds: [makeRound({ round_number: 0, added_description: "First note." })],
    });
    const next = applyClarification(session, "Second?", "Second note.");

    expect(next.rounds[0]?.added_description).toBe(
      "First note.\n\nSecond?\nSecond note.",
    );
  });

  it("refuses while a round is still running", () => {
    expect(() => applyClarification(finalized({ status: "analyzing" }), "", "x")).toThrow(
      /Cannot clarify/,
    );
  });

  it("refuses an empty answer", () => {
    expect(() => applyClarification(finalized(), "Budget?", "   ")).toThrow(
      /Answer the open item/,
    );
  });

  it("refuses once every round has been used", () => {
    const rounds = Array.from({ length: SCOPING.maxTotalRounds }, (_, i) =>
      makeRound({ round_number: i }),
    );
    expect(() => applyClarification(finalized({ rounds }), "", "More.")).toThrow(
      /used all/,
    );
  });

  it("refuses text that would blow the user-content budget", () => {
    const huge = "a".repeat(60_000);
    expect(() => applyClarification(finalized(), "", huge)).toThrow();
  });
});

describe("canGenerateAnyway", () => {
  it("is offered once a round has produced questions", () => {
    expect(
      canGenerateAnyway({ status: "awaiting_answers", rounds: [makeRound({})] }),
    ).toBe(true);
    expect(canGenerateAnyway({ status: "blocker", rounds: [makeRound({})] })).toBe(true);
    expect(canGenerateAnyway({ status: "needs_input", rounds: [makeRound({})] })).toBe(
      true,
    );
  });

  it("is not offered before the first round finishes", () => {
    expect(canGenerateAnyway({ status: "awaiting_answers", rounds: [] })).toBe(false);
    expect(canGenerateAnyway({ status: "analyzing", rounds: [makeRound({})] })).toBe(
      false,
    );
  });

  it("is not offered when the ordinary button already is", () => {
    expect(canGenerateAnyway({ status: "ready", rounds: [makeRound({})] })).toBe(false);
    expect(canGenerateAnyway({ status: "finalized", rounds: [makeRound({})] })).toBe(
      false,
    );
  });
});
