import { afterEach, describe, expect, it, vi } from "vitest";
import { OPENROUTER_TIMEOUT_MS, openRouterClient } from "@/lib/llm/openrouter";

// messagesCreate needs a key; getServerEnv() reads env lazily on first use.
process.env.OPENROUTER_API_KEY = "sk-or-test-000000000000000000000000";

function openAiReply(finishReason: string) {
  return {
    id: "gen-1",
    choices: [
      {
        finish_reason: finishReason,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "extract_modules", arguments: '{"modules":["Auth"]}' },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
}

function stubFetch(body: unknown) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function create() {
  return openRouterClient.messages.create({
    model: "ignored",
    max_tokens: 100,
    messages: [{ role: "user" as const, content: "hi" }],
    tools: [
      {
        name: "extract_modules",
        description: "Module names from a README",
        input_schema: { type: "object" },
      },
    ],
    tool_choice: { type: "tool", name: "extract_modules" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenRouter adapter", () => {
  it.each([
    ["length", "max_tokens"],
    ["tool_calls", "tool_use"],
    ["stop", "end_turn"],
  ])("maps finish_reason %s to stop_reason %s", async (finishReason, stopReason) => {
    stubFetch(openAiReply(finishReason));
    const message = await create();
    expect(message.stop_reason).toBe(stopReason);
  });

  it("gives every request a 45 s abort signal", async () => {
    const fetchMock = stubFetch(openAiReply("tool_calls"));
    await create();
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(OPENROUTER_TIMEOUT_MS).toBe(45_000);
  });

  it("disables optional reasoning for structured pipeline calls", async () => {
    const fetchMock = stubFetch(openAiReply("tool_calls"));
    await create();
    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as { reasoning_effort?: string };
    expect(body.reasoning_effort).toBe("none");
  });

  it("selects separate credentials for main and fast tiers", async () => {
    vi.stubEnv("OPENROUTER_MAIN_API_KEY", "sk-or-main-000000000000000000000000");
    vi.stubEnv("OPENROUTER_FAST_API_KEY", "sk-or-fast-000000000000000000000000");
    vi.resetModules();
    const fresh = (await import("@/lib/llm/openrouter")).openRouterClient;
    const fetchMock = stubFetch(openAiReply("tool_calls"));
    const request = {
      model: "test",
      max_tokens: 100,
      messages: [{ role: "user" as const, content: "hi" }],
    };

    await fresh.messages.create({ ...request, tier: "main" });
    await fresh.messages.create({ ...request, tier: "fast" });

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer sk-or-main-000000000000000000000000",
      }),
    );
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer sk-or-fast-000000000000000000000000",
      }),
    );
  });
});
