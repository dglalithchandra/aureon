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

function contentReply(content: string) {
  return {
    id: "gen-content",
    choices: [{ finish_reason: "stop", message: { role: "assistant", content } }],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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

  it("honours a whole-call abort without retrying or using the standby key", async () => {
    vi.stubEnv("OPENROUTER_FALLBACK_API_KEY", "sk-or-standby-0000000000000000000000");
    const controller = new AbortController();
    controller.abort(new DOMException("deadline", "TimeoutError"));
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw init.signal.reason;
      return new Response(JSON.stringify(openAiReply("tool_calls")), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      openRouterClient.messages.create({
        model: "test",
        max_tokens: 100,
        messages: [{ role: "user", content: "hi" }],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the lowest reasoning effort for structured pipeline calls", async () => {
    const fetchMock = stubFetch(openAiReply("tool_calls"));
    await create();
    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as { reasoning_effort?: string };
    expect(body.reasoning_effort).toBe("low");
  });

  it("disables reasoning for the default Nemotron extraction model", async () => {
    const fetchMock = stubFetch(openAiReply("tool_calls"));
    await openRouterClient.messages.create({
      model: "nvidia/nemotron-3.5-super-vl:free",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          name: "extract_modules",
          description: "Extract module names",
          input_schema: { type: "object" },
        },
      ],
      tool_choice: { type: "tool", name: "extract_modules" },
    });
    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as { reasoning_effort?: string };
    expect(body.reasoning_effort).toBe("none");
  });

  it("requires an endpoint that supports all requested tool parameters", async () => {
    const fetchMock = stubFetch(openAiReply("tool_calls"));
    await create();
    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as {
      provider?: { require_parameters?: boolean };
    };
    expect(body.provider?.require_parameters).toBe(true);
  });

  it("unwraps a tool-call envelope returned in message content", async () => {
    stubFetch(
      contentReply(
        JSON.stringify({
          name: "extract_modules",
          arguments: JSON.stringify({ modules: ["Auth"] }),
        }),
      ),
    );
    const message = await create();
    expect(message.content[0]).toEqual(
      expect.objectContaining({
        type: "tool_use",
        name: "extract_modules",
        input: { modules: ["Auth"] },
      }),
    );
  });

  it("surfaces an OpenRouter error body when a 200 response has no choices", async () => {
    stubFetch({ error: { code: 429, message: "Free model rate limit reached" } });
    await expect(create()).rejects.toThrow(
      "OpenRouter returned no choices: Free model rate limit reached",
    );
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

  it("uses the standby key after the tier key is rejected", async () => {
    vi.stubEnv("OPENROUTER_MAIN_API_KEY", "sk-or-main-000000000000000000000000");
    vi.stubEnv("OPENROUTER_FALLBACK_API_KEY", "sk-or-standby-0000000000000000000000");
    vi.resetModules();
    const fresh = (await import("@/lib/llm/openrouter")).openRouterClient;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "API key expired" } }), {
          status: 401,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(openAiReply("tool_calls")), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await fresh.messages.create({
      model: "test",
      max_tokens: 100,
      tier: "main",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer sk-or-main-000000000000000000000000",
      }),
    );
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer sk-or-standby-0000000000000000000000",
      }),
    );
  });

  it("rotates a daily-quota 429 to the next key without retrying it", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-main-000000000000000000000000");
    vi.stubEnv("OPENROUTER_MAIN_API_KEY", "sk-or-main-000000000000000000000000");
    vi.stubEnv("OPENROUTER_FAST_API_KEY", "sk-or-fast-000000000000000000000000");
    vi.stubEnv("OPENROUTER_FALLBACK_API_KEY", "sk-or-standby-0000000000000000000000");
    vi.resetModules();
    const fresh = (await import("@/lib/llm/openrouter")).openRouterClient;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { message: "Rate limit exceeded: free-models-per-day" },
          }),
          { status: 429 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(openAiReply("tool_calls")), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await fresh.messages.create({
      model: "test",
      max_tokens: 100,
      tier: "main",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer sk-or-main-000000000000000000000000",
      }),
    );
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer sk-or-standby-0000000000000000000000",
      }),
    );
  });

  it("does not spend the standby key on malformed requests", async () => {
    vi.stubEnv("OPENROUTER_MAIN_API_KEY", "sk-or-main-000000000000000000000000");
    vi.stubEnv("OPENROUTER_FALLBACK_API_KEY", "sk-or-standby-0000000000000000000000");
    vi.resetModules();
    const fresh = (await import("@/lib/llm/openrouter")).openRouterClient;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Bad request" } }), {
        status: 400,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fresh.messages.create({
        model: "test",
        max_tokens: 100,
        tier: "main",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow("OpenRouter 400");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
