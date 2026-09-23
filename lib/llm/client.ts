import "@/lib/server-only";
import { getServerEnv } from "@/lib/env";
import { consumeLlmBudget } from "@/lib/llm/budget";
import { geminiClient } from "@/lib/llm/gemini";
import { openRouterClient } from "@/lib/llm/openrouter";
import type { LlmClient, LlmRequest, LlmResponse } from "@/lib/llm/types";

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

let client: LlmClient | null = null;
let cachedProvider: string | null = null;

function getClient(): LlmClient {
  const env = getServerEnv();
  if (client && cachedProvider === env.LLM_PROVIDER) return client;
  cachedProvider = env.LLM_PROVIDER;
  client = env.LLM_PROVIDER === "openrouter" ? openRouterClient : geminiClient;
  return client;
}

/**
 * Count the call against the global daily budget (throws
 * BudgetExceededError past LLM_DAILY_CALL_LIMIT), then send it.
 */
export async function createLlmMessage(params: LlmRequest): Promise<LlmResponse> {
  await consumeLlmBudget();
  return getClient().messages.create(params);
}

/**
 * Which model a call should use. Two tiers:
 *
 *   main  the pipeline — extraction, questions, both output documents
 *   fast  small mechanical jobs, e.g. reading module names out of a README
 *
 * The ids come from the environment (GEMINI_MODEL, GEMINI_FAST_MODEL) so a
 * model can be swapped without a deploy of new code. OpenRouter ignores the
 * string and uses OPENROUTER_MODEL.
 */
export function promptModel(tier: "main" | "fast"): string {
  const env = getServerEnv();
  if (env.LLM_PROVIDER === "openrouter") return env.OPENROUTER_MODEL ?? "openrouter";
  return tier === "fast" ? env.GEMINI_FAST_MODEL : env.GEMINI_MODEL;
}
