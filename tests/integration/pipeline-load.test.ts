import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession, runRound } from "@/lib/pipeline/orchestrator";
import { startMockLlm, type MockLlm } from "../mocks/mock-llm";

/**
 * A small, deterministic concurrency check. It is not a capacity benchmark;
 * it proves simultaneous sessions do not share state or lose pipeline stages.
 */
describe("concurrent pipeline smoke load", () => {
  let mock: MockLlm;

  beforeAll(async () => {
    mock = await startMockLlm();
    process.env.GEMINI_BASE_URL = mock.url;
  });

  afterAll(async () => mock.close());

  it("isolates eight simultaneous first-round sessions", async () => {
    mock.setDelay(10);
    const sessions = Array.from({ length: 8 }, (_, index) =>
      createSession(
        `We need an internal account management tool ${index} with staff login and admin roles.`,
      ),
    );

    const results = await Promise.all(sessions.map((session) => runRound(session)));
    expect(new Set(results.map((session) => session.id)).size).toBe(8);
    expect(results.every((session) => session.status === "awaiting_answers")).toBe(true);
    expect(results.every((session) => session.rounds.length === 1)).toBe(true);
    expect(mock.callsFor("submit_extraction")).toHaveLength(8);
    expect(mock.callsFor("generate_clarification_questions")).toHaveLength(8);
  });
});
