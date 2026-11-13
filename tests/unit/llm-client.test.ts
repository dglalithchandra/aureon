import { afterEach, describe, expect, it, vi } from "vitest";
import { promptModel, providerForTier } from "@/lib/llm/client";

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
    expect(providerForTier("main")).toBe("gemini");
    expect(providerForTier("fast")).toBe("gemini");
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

  it("routes the fast tier independently while main inherits the legacy provider", async () => {
    vi.stubEnv("LLM_FAST_PROVIDER", "openrouter");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-000000000000000000000000");
    vi.stubEnv("OPENROUTER_MODEL", "main-openrouter-model");
    vi.stubEnv("OPENROUTER_FAST_MODEL", "fast-openrouter-model");
    vi.resetModules();
    const fresh = await import("@/lib/llm/client");
    expect(fresh.providerForTier("main")).toBe("gemini");
    expect(fresh.providerForTier("fast")).toBe("openrouter");
    expect(fresh.promptModel("main")).toBe("gemini-test-main");
    expect(fresh.promptModel("fast")).toBe("fast-openrouter-model");
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

  it("uses the fast provider for a fast-tier request", async () => {
    vi.stubEnv("LLM_FAST_PROVIDER", "openrouter");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-000000000000000000000000");
    vi.stubEnv("OPENROUTER_MODEL", "main-openrouter-model");
    vi.stubEnv("OPENROUTER_FAST_MODEL", "fast-openrouter-model");
    vi.resetModules();
    const geminiCreate = vi.fn();
    const openRouterCreate = vi.fn(async () => ({
      id: "or_fast",
      model: "fast-openrouter-model",
      content: [],
      stop_reason: "end_turn" as const,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    }));
    vi.doMock("@/lib/llm/gemini", () => ({
      geminiClient: { messages: { create: geminiCreate } },
    }));
    vi.doMock("@/lib/llm/openrouter", () => ({
      openRouterClient: { messages: { create: openRouterCreate } },
    }));

    const { createLlmMessage } = await import("@/lib/llm/client");
    await createLlmMessage({
      tier: "fast",
      model: "ignored",
      max_tokens: 10,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(geminiCreate).not.toHaveBeenCalled();
    expect(openRouterCreate).toHaveBeenCalledWith(
      expect.objectContaining({ tier: "fast", model: "fast-openrouter-model" }),
    );
    vi.doUnmock("@/lib/llm/gemini");
    vi.doUnmock("@/lib/llm/openrouter");
  });

  it("falls back once to a different provider after a provider failure", async () => {
    vi.stubEnv("LLM_FALLBACK_PROVIDER", "openrouter");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-000000000000000000000000");
    vi.stubEnv("OPENROUTER_MODEL", "fallback-openrouter-model");
    vi.resetModules();
    const geminiCreate = vi.fn(async () => {
      throw new Error("Gemini unavailable");
    });
    const openRouterCreate = vi.fn(async () => ({
      id: "or_fallback",
      model: "fallback-openrouter-model",
      content: [],
      stop_reason: "end_turn" as const,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    }));
    vi.doMock("@/lib/llm/gemini", () => ({
      geminiClient: { messages: { create: geminiCreate } },
    }));
    vi.doMock("@/lib/llm/openrouter", () => ({
      openRouterClient: { messages: { create: openRouterCreate } },
    }));

    const { createLlmMessage } = await import("@/lib/llm/client");
    const result = await createLlmMessage({
      tier: "main",
      model: "ignored",
      max_tokens: 10,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(geminiCreate).toHaveBeenCalledOnce();
    expect(openRouterCreate).toHaveBeenCalledWith(
      expect.objectContaining({ tier: "main", model: "fallback-openrouter-model" }),
    );
    expect(result.id).toBe("or_fallback");
    vi.doUnmock("@/lib/llm/gemini");
    vi.doUnmock("@/lib/llm/openrouter");
  });
});
