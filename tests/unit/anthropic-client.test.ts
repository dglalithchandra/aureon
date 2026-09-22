import { describe, expect, it, vi } from "vitest";

// Capture the options the app passes to the Anthropic SDK constructor.
const captured = vi.hoisted(() => ({ options: [] as unknown[] }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async () => ({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-test",
        content: [],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    };
    constructor(options: unknown) {
      captured.options.push(options);
    }
  },
}));

describe("Anthropic client", () => {
  it("sets a 45 s per-request timeout and keeps 2 SDK retries", async () => {
    const { ANTHROPIC_TIMEOUT_MS, createLlmMessage } =
      await import("@/lib/llm/anthropic");

    await createLlmMessage({
      model: "claude-test",
      max_tokens: 10,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(ANTHROPIC_TIMEOUT_MS).toBe(45_000);
    expect(captured.options[0]).toMatchObject({ timeout: 45_000, maxRetries: 2 });
  });
});
