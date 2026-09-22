import "@/lib/server-only";
import { ephemeralCacheControl, PromptModel } from "@/lib/llm/anthropic";
import { callToolWithRepair } from "@/lib/llm/structured";
import {
  EXTRACTION_SYSTEM_PROMPT,
  submitExtractionTool,
} from "@/lib/llm/prompts/extract";
import {
  ExtractionResultStrictSchema,
  type ExtractionResult,
} from "@/lib/schemas/extraction";
import { BudgetExceededError, LLMError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { stripHtml, truncateText } from "@/lib/security/sanitize";

const MAX_INPUT_CHARS = 50_000;
const MAX_PRIOR_CONTEXT_CHARS = 50_000;

interface RunExtractionOptions {
  rawText: string;
  priorContext?: string;
}

/**
 * Run the extraction pipeline: forced tool use, strict Zod validation with
 * one repair retry (see callToolWithRepair). Throws `LLMError` (502) on
 * transport errors and on model output that is still invalid after the retry.
 */
export async function runExtraction(
  opts: RunExtractionOptions,
): Promise<ExtractionResult> {
  const cleanedRaw = truncateText(stripHtml(opts.rawText), MAX_INPUT_CHARS);
  const cleanedPrior = opts.priorContext
    ? truncateText(stripHtml(opts.priorContext), MAX_PRIOR_CONTEXT_CHARS)
    : null;

  const userBlocks: string[] = [];
  userBlocks.push(`<client_input>\n${cleanedRaw}\n</client_input>`);
  if (cleanedPrior) {
    userBlocks.push(`<prior_round_context>\n${cleanedPrior}\n</prior_round_context>`);
  }
  userBlocks.push(
    "Call submit_extraction now with your complete analysis. Do not respond with any other text.",
  );

  const startedAt = Date.now();

  let outcome;
  try {
    outcome = await callToolWithRepair({
      label: "extract",
      toolName: submitExtractionTool.name,
      parse: (input) => ExtractionResultStrictSchema.safeParse(input),
      params: {
        model: PromptModel.SONNET,
        max_tokens: 4096,
        system: [
          {
            type: "text",
            text: EXTRACTION_SYSTEM_PROMPT,
            cache_control: ephemeralCacheControl,
          },
        ],
        tools: [submitExtractionTool],
        tool_choice: { type: "tool", name: submitExtractionTool.name },
        messages: [{ role: "user", content: userBlocks.join("\n\n") }],
      },
    });
  } catch (err) {
    // The budget error must reach the route as a 503, not become an LLMError.
    if (err instanceof BudgetExceededError) throw err;
    const message = err instanceof Error ? err.message : "unknown error";
    logger.error("extract.anthropic_failure", { message });
    throw new LLMError("Extraction model call failed");
  }

  const { response } = outcome;
  logger.info("extract.completed", {
    durationMs: Date.now() - startedAt,
    attempts: outcome.attempts,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    stopReason: response.stop_reason,
  });

  if (!outcome.ok) {
    // Bad model output is an upstream failure (502), not a client error.
    logger.error("extract.invalid_output", { issues: outcome.issues });
    throw new LLMError(`Extraction output failed validation: ${outcome.issues}`);
  }

  return outcome.data;
}
