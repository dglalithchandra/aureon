import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GEMINI_TIMEOUT_MS,
  GeminiError,
  buildRequestBody,
  geminiClient,
  parseResponse,
  sanitiseSchema,
} from "@/lib/llm/gemini";
import type { LlmRequest } from "@/lib/llm/types";

/**
 * The Gemini adapter: how a pipeline request becomes an Interactions call,
 * and how the reply becomes the shape lib/pipeline/* expects.
 */

const REQUEST: LlmRequest = {
  model: "gemini-test-main",
  max_tokens: 4096,
  system: [
    { type: "text", text: "You are Aureon." },
    { type: "text", text: "Be honest about gaps." },
  ],
  tools: [
    {
      name: "submit_extraction",
      description: "Submit the analysis",
      input_schema: { type: "object", properties: { domain: { type: "string" } } },
    },
  ],
  tool_choice: { type: "tool", name: "submit_extraction" },
  messages: [{ role: "user", content: "A booking tool for my salon." }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the request", () => {
  it("carries the system prompt, the input and the forced tool", () => {
    const body = buildRequestBody(REQUEST);

    expect(body.model).toBe("gemini-test-main");
    expect(body.system_instruction).toBe("You are Aureon.\n\nBe honest about gaps.");
    expect(body.input).toEqual([
      {
        type: "user_input",
        content: [{ type: "text", text: "A booking tool for my salon." }],
      },
    ]);
    expect(body.generation_config.max_output_tokens).toBe(4096);
    expect(body.generation_config.tool_choice).toEqual({
      allowed_tools: { mode: "any", tools: ["submit_extraction"] },
    });
    expect(body.tools?.[0]).toMatchObject({
      type: "function",
      name: "submit_extraction",
      description: "Submit the analysis",
    });
  });

  it("never asks the provider to store the client's text", () => {
    // The brief is the client's own words; it stays out of Google's history.
    expect(buildRequestBody(REQUEST).store).toBe(false);
  });

  it("works without a system prompt or tools", () => {
    const body = buildRequestBody({
      model: "m",
      max_tokens: 10,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(body.system_instruction).toBeUndefined();
    expect(body.tools).toBeUndefined();
    expect(body.generation_config.tool_choice).toBeUndefined();
  });
});

describe("schema sanitising", () => {
  it("drops the keywords the function-declaration format rejects", () => {
    const cleaned = sanitiseSchema({
      type: "object",
      description: "A record of module → concerns",
      additionalProperties: { type: "array", items: { type: "string" } },
      $schema: "https://json-schema.org/draft/2020-12/schema",
      properties: {
        name: { type: "string", maxLength: 80, pattern: "^[a-z]+$" },
        sizes: {
          type: "array",
          maxItems: 3,
          items: { type: "string", enum: ["SMALL", "LARGE"], default: "SMALL" },
        },
      },
      required: ["name"],
    });

    expect(cleaned).toEqual({
      type: "object",
      description: "A record of module → concerns",
      properties: {
        name: { type: "string" },
        sizes: {
          type: "array",
          maxItems: 3,
          items: { type: "string", enum: ["SMALL", "LARGE"] },
        },
      },
      required: ["name"],
    });
  });

  it("leaves a record-shaped object free-form rather than sending it", () => {
    // security_per_module is `additionalProperties`-only; Zod still checks it.
    const cleaned = sanitiseSchema({
      type: "object",
      description: "module → concerns",
      additionalProperties: { type: "array" },
    });
    expect(cleaned).toEqual({ type: "object", description: "module → concerns" });
  });

  it("survives junk", () => {
    expect(sanitiseSchema(null)).toEqual({});
    expect(sanitiseSchema("nope")).toEqual({});
    expect(sanitiseSchema([1, 2])).toEqual({});
  });
});

describe("the response", () => {
  it("turns a function_call step into a tool_use block", () => {
    const parsed = parseResponse(
      {
        id: "int_1",
        model: "gemini-test-main",
        status: "completed",
        steps: [
          {
            type: "function_call",
            id: "call_1",
            name: "submit_extraction",
            arguments: { domain: "SaaS" },
          },
        ],
        usage: {
          total_input_tokens: 1200,
          total_output_tokens: 300,
          total_cached_tokens: 400,
          total_thought_tokens: 50,
        },
      },
      "fallback",
    );

    expect(parsed.stop_reason).toBe("tool_use");
    expect(parsed.content).toEqual([
      {
        type: "tool_use",
        id: "call_1",
        name: "submit_extraction",
        input: { domain: "SaaS" },
      },
    ]);
    // Thinking tokens are billed as output, so they are counted there.
    expect(parsed.usage).toEqual({
      input_tokens: 1200,
      output_tokens: 350,
      cache_read_input_tokens: 400,
      cache_creation_input_tokens: 0,
    });
  });

  it("parses arguments that arrive as a JSON string", () => {
    const parsed = parseResponse(
      {
        steps: [{ type: "function_call", name: "t", arguments: '{"modules":["Auth"]}' }],
      },
      "m",
    );
    expect(parsed.content[0]).toMatchObject({ input: { modules: ["Auth"] } });
  });

  it("does not crash on arguments that are not JSON", () => {
    const parsed = parseResponse(
      { steps: [{ type: "function_call", name: "t", arguments: "not json" }] },
      "m",
    );
    expect(parsed.content[0]).toMatchObject({ input: {} });
  });

  it("reports truncated output as max_tokens so the caller retries bigger", () => {
    const parsed = parseResponse({ status: "incomplete", steps: [] }, "m");
    expect(parsed.stop_reason).toBe("max_tokens");
    expect(parsed.content).toEqual([]);
  });

  it("keeps plain text when the model answered without calling the tool", () => {
    const parsed = parseResponse(
      {
        status: "completed",
        steps: [{ type: "model_output", content: [{ type: "text", text: "Hello" }] }],
      },
      "m",
    );
    expect(parsed.stop_reason).toBe("end_turn");
    expect(parsed.content).toEqual([{ type: "text", text: "Hello" }]);
  });

  it("falls back to output_text when there are no steps", () => {
    const parsed = parseResponse({ output_text: "Hi" }, "m");
    expect(parsed.content).toEqual([{ type: "text", text: "Hi" }]);
  });

  it("defaults usage to zeros when the provider omits it", () => {
    expect(parseResponse({ steps: [] }, "m").usage).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
  });
});

describe("transport", () => {
  const ok = {
    id: "int_1",
    status: "completed",
    steps: [{ type: "function_call", name: "submit_extraction", arguments: {} }],
    usage: { total_input_tokens: 1, total_output_tokens: 1 },
  };

  function reply(body: unknown, status = 200, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  }

  it("sends the key in the header, to the interactions endpoint", async () => {
    const fetchMock = vi.fn(async () => reply(ok));
    vi.stubGlobal("fetch", fetchMock);

    await geminiClient.messages.create(REQUEST);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/v1beta\/interactions$/);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBeTruthy();
    expect(init.method).toBe("POST");
  });

  it("retries a 429 — the free tier's rate limit — and then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        reply({ error: { status: "RESOURCE_EXHAUSTED", message: "Quota" } }, 429, {
          "retry-after": "0",
        }),
      )
      .mockResolvedValueOnce(reply(ok));
    vi.stubGlobal("fetch", fetchMock);

    const res = await geminiClient.messages.create(REQUEST);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.stop_reason).toBe("tool_use");
  });

  it("gives up on a 429 that never clears, and says why", async () => {
    const fetchMock = vi.fn(async () =>
      reply({ error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } }, 429, {
        "retry-after": "0",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(geminiClient.messages.create(REQUEST)).rejects.toThrow(/free tier/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a bad request", async () => {
    const fetchMock = vi.fn(async () =>
      reply({ error: { status: "INVALID_ARGUMENT", message: "Bad schema" } }, 400),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(geminiClient.messages.create(REQUEST)).rejects.toThrow(/Bad schema/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("wraps a network failure in a GeminiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    );
    await expect(geminiClient.messages.create(REQUEST)).rejects.toBeInstanceOf(
      GeminiError,
    );
  });

  it("gives every attempt its own 45 s deadline", () => {
    expect(GEMINI_TIMEOUT_MS).toBe(45_000);
  });
});
