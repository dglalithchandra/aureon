import "@/lib/server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getServerEnv } from "@/lib/env";
import { consumeLlmBudget } from "@/lib/llm/budget";
import { openRouterClient } from "@/lib/llm/openrouter";

/**
 * LLM client dispatcher. Returns a value whose `.messages.create(...)`
 * surface is structurally compatible with `Anthropic.Messages.create`.
 *
 *   LLM_PROVIDER=anthropic  → real Anthropic SDK (production default).
 *   LLM_PROVIDER=openrouter → OpenRouter adapter (free models for dev).
 *
 * `import "@/lib/server-only"` makes any accidental client import a build
 * error. The dispatcher is memoized per provider so repeated calls reuse
 * the underlying connection pool.
 */

type AnthropicLike = Pick<Anthropic, "messages">;

/** Per-attempt request timeout for the Anthropic SDK. */
export const ANTHROPIC_TIMEOUT_MS = 45_000;

let client: AnthropicLike | null = null;
let cachedProvider: string | null = null;

function getAnthropic(): AnthropicLike {
  const env = getServerEnv();
  if (client && cachedProvider === env.LLM_PROVIDER) return client;
  cachedProvider = env.LLM_PROVIDER;

  if (env.LLM_PROVIDER === "openrouter") {
    client = openRouterClient as unknown as AnthropicLike;
    return client;
  }

  client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY!,
    maxRetries: 2,
    // Per-attempt deadline (ROB-01); the SDK retries timeouts like 5xx.
    timeout: ANTHROPIC_TIMEOUT_MS,
  });
  return client;
}

/**
 * The only way to call the model. Counts the call against the global daily
 * budget first (throws BudgetExceededError past LLM_DAILY_CALL_LIMIT), then
 * sends it to the configured provider.
 */
export async function createLlmMessage(
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  await consumeLlmBudget();
  return getAnthropic().messages.create(params);
}

/**
 * Default model strings used by the pipeline. When LLM_PROVIDER=openrouter
 * these strings are still passed in the request — the OpenRouter adapter
 * ignores them and substitutes its own configured model.
 */
export const PromptModel = {
  SONNET: "claude-sonnet-4-6",
  HAIKU: "claude-haiku-4-5-20251001",
} as const;

/**
 * Standard cache_control marker. Attach to the LAST content block of the
 * system prompt so Anthropic caches everything before it. Cache hits cut
 * input cost ~10x and reduce TTFT. Ignored by the OpenRouter adapter.
 */
export const ephemeralCacheControl = { type: "ephemeral" as const };
