import { afterEach, describe, expect, it, vi } from "vitest";
import { promptModel } from "@/lib/llm/client";

/** The dispatcher: which provider answers, and with which model. */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("model tiers", () => {
  it("uses the configured Gemini models", () => {
    // tests/setup.ts pins these two.
    expect(promptModel("main")).toBe("gemini-test-main");
    expect(promptModel("fast")).toBe("gemini-test-fast");
  });

  it("is overridable by environment, so a model swap needs no deploy", async () => {
    vi.stubEnv("GEMINI_MODEL", "gemini-something-newer");
    vi.resetModules();
    const { promptModel: fresh } = await import("@/lib/llm/client");
    expect(fresh("main")).toBe("gemini-something-newer");
  });

  it("hands OpenRouter its own model id", async () => {
    vi.stubEnv("LLM_PROVIDER", "openrouter");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-000000000000000000000000");
    vi.stubEnv("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct:free");
    vi.resetModules();
    const { promptModel: fresh } = await import("@/lib/llm/client");
    expect(fresh("main")).toBe("meta-llama/llama-3.3-70b-instruct:free");
    expect(fresh("fast")).toBe("meta-llama/llama-3.3-70b-instruct:free");
  });
});

describe("provider selection", () => {
  it("sends the call to Gemini by default", async () => {
    vi.resetModules();
    const create = vi.fn(async () => ({
      id: "int_1",
      model: "gemini-test-main",
      content: [],
      stop_reason: "end_turn" as const,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    }));
    vi.doMock("@/lib/llm/gemini", () => ({ geminiClient: { messages: { create } } }));

    const { createLlmMessage } = await import("@/lib/llm/client");
    await createLlmMessage({
      model: "gemini-test-main",
      max_tokens: 10,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(create).toHaveBeenCalledOnce();
    vi.doUnmock("@/lib/llm/gemini");
  });

  it("sends it to OpenRouter when that provider is configured", async () => {
    vi.stubEnv("LLM_PROVIDER", "openrouter");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-000000000000000000000000");
    vi.resetModules();
    const create = vi.fn(async () => ({
      id: "or_1",
      model: "free-model",
      content: [],
      stop_reason: "end_turn" as const,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    }));
    vi.doMock("@/lib/llm/openrouter", () => ({
      openRouterClient: { messages: { create } },
    }));

    const { createLlmMessage } = await import("@/lib/llm/client");
    await createLlmMessage({
      model: "ignored",
      max_tokens: 10,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(create).toHaveBeenCalledOnce();
    vi.doUnmock("@/lib/llm/openrouter");
  });
});
