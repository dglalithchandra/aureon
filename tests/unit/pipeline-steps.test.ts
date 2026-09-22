import { describe, expect, it } from "vitest";
import { deriveSteps } from "@/components/chat/pipelineSteps";
import type { PipelineStage, Session } from "@/lib/schemas/mcq";
import { makeRound, makeSession } from "../fixtures/llm";

function analyzing(stage: PipelineStage | null, rounds = 0): Session {
  return makeSession({
    status: "analyzing",
    pipeline_stage: stage,
    rounds: Array.from({ length: rounds }, (_, i) => makeRound({ round_number: i })),
  });
}

describe("deriveSteps", () => {
  it("is all pending before anything starts", () => {
    expect(deriveSteps(null, false)).toEqual({
      extract: "pending",
      github: "pending",
      score: "pending",
      decide: "pending",
      output: "pending",
    });
  });

  it("marks extract running as soon as the client knows it is analyzing", () => {
    expect(deriveSteps(null, true).extract).toBe("running");
    expect(deriveSteps(analyzing("extracting"), true).extract).toBe("running");
  });

  it.each([
    ["github", { extract: "done", github: "running", score: "pending" }],
    ["scoring", { extract: "done", github: "done", score: "running", decide: "pending" }],
    ["clarifying", { score: "done", decide: "running", output: "pending" }],
  ] as const)("follows the live pipeline stage %s on round 0", (stage, expected) => {
    expect(deriveSteps(analyzing(stage), true)).toMatchObject(expected);
  });

  it("follows the live stage on later rounds too (not just 'decide running')", () => {
    // A second round after answers: the previous round has landed, but the
    // server is extracting again. This is what the mobile panel used to miss.
    const steps = deriveSteps(analyzing("extracting", 1), true);
    expect(steps).toEqual({
      extract: "running",
      github: "pending",
      score: "pending",
      decide: "pending",
      output: "pending",
    });
    expect(deriveSteps(analyzing("scoring", 1), true).score).toBe("running");
  });

  it.each(["awaiting_answers", "blocker"] as const)(
    "waits on the user in %s",
    (status) => {
      const steps = deriveSteps(
        makeSession({ status, pipeline_stage: null, rounds: [makeRound()] }),
        false,
      );
      expect(steps).toEqual({
        extract: "done",
        github: "done",
        score: "done",
        decide: "running",
        output: "pending",
      });
    },
  );

  it("runs output once the session is ready, and finishes when finalized", () => {
    const ready = makeSession({
      status: "ready",
      pipeline_stage: null,
      rounds: [makeRound()],
    });
    expect(deriveSteps(ready, false)).toMatchObject({
      decide: "done",
      output: "running",
    });

    const done = { ...ready, status: "finalized" as const };
    expect(Object.values(deriveSteps(done, false))).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
    ]);
  });
});
