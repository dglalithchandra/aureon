import { describe, expect, it } from "vitest";
import {
  isBusyStatus,
  isFatalPollStatus,
  nextPollInterval,
  pollDelayMs,
  showAlreadyWorking,
} from "@/components/chat/polling";

describe("pollDelayMs", () => {
  it.each([
    [0, 1500],
    [9_999, 1500],
    [10_000, 3000],
    [29_999, 3000],
    [30_000, 5000],
    [120_000, 5000],
  ])("after %d ms of analyzing, waits %d ms", (elapsed, delay) => {
    expect(pollDelayMs(elapsed)).toBe(delay);
  });

  it("needs 16 polls for a 40 s round (27 at a flat 1.5 s)", () => {
    let t = 0;
    let polls = 0;
    while (t < 40_000) {
      t += pollDelayMs(t);
      polls++;
    }
    expect(polls).toBe(16);
  });
});

describe("nextPollInterval", () => {
  it("polls only while the session is analyzing", () => {
    expect(
      nextPollInterval({
        sessionStatus: "analyzing",
        errorStatus: undefined,
        analyzingForMs: 0,
      }),
    ).toBe(1500);
    for (const status of [
      "awaiting_answers",
      "blocker",
      "ready",
      "finalized",
      undefined,
    ]) {
      expect(
        nextPollInterval({
          sessionStatus: status,
          errorStatus: undefined,
          analyzingForMs: 0,
        }),
      ).toBe(false);
    }
  });

  it.each([401, 404])("stops for good on %d", (errorStatus) => {
    expect(
      nextPollInterval({ sessionStatus: "analyzing", errorStatus, analyzingForMs: 0 }),
    ).toBe(false);
  });

  it("keeps polling (with back-off) through a 429", () => {
    expect(
      nextPollInterval({
        sessionStatus: "analyzing",
        errorStatus: 429,
        analyzingForMs: 12_000,
      }),
    ).toBe(3000);
  });
});

describe("status classification", () => {
  it("treats 401/404 as fatal and 429 as busy", () => {
    expect([401, 404, 429, 500].map(isFatalPollStatus)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect([401, 404, 429, 500].map(isBusyStatus)).toEqual([false, false, true, false]);
  });
});

describe("showAlreadyWorking", () => {
  it("shows the notice after a 409 only while the round is still analyzing", () => {
    expect(showAlreadyWorking(true, "analyzing")).toBe(true);
    expect(showAlreadyWorking(true, "awaiting_answers")).toBe(false);
    expect(showAlreadyWorking(false, "analyzing")).toBe(false);
  });
});
