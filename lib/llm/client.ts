import "@/lib/server-only";
import { getServerEnv } from "@/lib/env";
import { consumeLlmBudget } from "@/lib/llm/budget";
import { geminiClient } from "@/lib/llm/gemini";
import { openRouterClient } from "@/lib/llm/openrouter";
import type { LlmClient, LlmRequest, LlmResponse, LlmTier } from "@/lib/llm/types";
import { logger } from "@/lib/logger";

/**
 * The only way to call a model.
 *
 *   LLM_PROVIDER=gemini      → Google Gemini (production default)
 *   LLM_PROVIDER=openrouter  → OpenRouter, for a free model in local dev
 *
 * Both adapters speak the shape in lib/llm/types.ts, so nothing above this
 * file knows which provider answered. `import "@/lib/server-only"` makes an
 * accidental client import a build error.
 */

export type LlmProvider = "gemini" | "openrouter";

function clientFor(provider: LlmProvider): LlmClient {
  return provider === "openrouter" ? openRouterClient : geminiClient;
}

/** Resolve one tier without changing existing LLM_PROVIDER-only setups. */
export function providerForTier(tier: LlmTier): LlmProvider {
  const env = getServerEnv();
  const main = env.LLM_MAIN_PROVIDER ?? env.LLM_PROVIDER;
  return tier === "fast" ? (env.LLM_FAST_PROVIDER ?? main) : main;
}

function modelFor(provider: LlmProvider, tier: LlmTier): string {
  const env = getServerEnv();
  if (provider === "openrouter") {
    if (tier === "fast" && env.OPENROUTER_FAST_MODEL) {
      return env.OPENROUTER_FAST_MODEL;
    }
    return env.OPENROUTER_MODEL ?? "openrouter/free";
  }
  return tier === "fast" ? env.GEMINI_FAST_MODEL : env.GEMINI_MODEL;
}

/**
 * Count the call against the global daily budget (throws
 * BudgetExceededError past LLM_DAILY_CALL_LIMIT), then send it.
 */
export async function createLlmMessage(params: LlmRequest): Promise<LlmResponse> {
  const tier = params.tier ?? "main";
  const primary = providerForTier(tier);
  const primaryParams = { ...params, model: modelFor(primary, tier), tier };
  await consumeLlmBudget();
  try {
    return await clientFor(primary).messages.create(primaryParams);
  } catch (err) {
    const fallback = getServerEnv().LLM_FALLBACK_PROVIDER;
    if (!fallback || fallback === primary) throw err;

    logger.warn("llm.provider_fallback", {
      tier,
      primary,
      fallback,
      message: err instanceof Error ? err.message : "unknown provider failure",
    });
    await consumeLlmBudget();
    return clientFor(fallback).messages.create({
      ...params,
      model: modelFor(fallback, tier),
      tier,
    });
  }
}

/**
 * Which model a call should use. Two tiers:
 *
 *   main  the pipeline — extraction, questions, both output documents
 *   fast  small mechanical jobs, e.g. reading module names out of a README
 *
 * The ids come from the selected provider's environment settings, so a model
 * or provider can be swapped without changing a pipeline call site.
 */
export function promptModel(tier: LlmTier): string {
  return modelFor(providerForTier(tier), tier);
}
