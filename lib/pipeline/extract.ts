import "@/lib/server-only";
import { promptModel } from "@/lib/llm/client";
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
import { promptSafe, truncateText } from "@/lib/text/prompt-safe";

/**
 * Characters the user message may use. The answers from earlier rounds are
 * written first and the raw brief gets what is left, so a long brief can
 * never push the answers out of the prompt (BUG-06).
 */
const PROMPT_BUDGET_CHARS = 50_000;
/** The brief always keeps at least this much, even against long answers. */
const MIN_RAW_CHARS = 2_000;

/** What one extraction call cost, for the evaluation harness (evals/run.ts). */
export interface ExtractionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** 1 unless the output needed the larger-budget or repair retry. */
  attempts: number;
}

interface RunExtractionOptions {
  rawText: string;
  /** Answers and added descriptions from earlier rounds, already formatted. */
  priorContext?: string;
  /**
   * Called with the usage of the final model response — a discarded earlier
   * attempt is not counted, so `attempts > 1` means the real spend was
   * higher. The pipeline ignores this; evals/run.ts reports tokens and cost.
   */
  onUsage?: (usage: ExtractionUsage) => void;
}

/**
 * Run the extraction pipeline: forced tool use, strict Zod validation with
 * one repair retry (see callToolWithRepair). Throws `LLMError` (502) on
 * transport errors and on model output that is still invalid after the retry.
 */
export async function runExtraction(
  opts: RunExtractionOptions,
): Promise<ExtractionResult> {
  // Reserve the budget for the answers first: they are the newest and most
  // specific information the model has (BUG-06). The caller already made the
  // text inside those blocks prompt-safe, so the block tags stay intact.
  const prior = (opts.priorContext ?? "").trim();
  const cleanedPrior = prior
    ? truncateText(prior, PROMPT_BUDGET_CHARS - MIN_RAW_CHARS)
    : null;
  const rawBudget = Math.max(
    MIN_RAW_CHARS,
    PROMPT_BUDGET_CHARS - (cleanedPrior?.length ?? 0),
  );
  const cleanedRaw = truncateText(promptSafe(opts.rawText), rawBudget);

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
        model: promptModel("main"),
        max_tokens: 4096,
        system: [{ type: "text", text: EXTRACTION_SYSTEM_PROMPT }],
        tools: [submitExtractionTool],
        tool_choice: { type: "tool", name: submitExtractionTool.name },
        messages: [{ role: "user", content: userBlocks.join("\n\n") }],
      },
    });
  } catch (err) {
    // The budget error must reach the route as a 503, not become an LLMError.
    if (err instanceof BudgetExceededError) throw err;
    const message = err instanceof Error ? err.message : "unknown error";
    logger.error("extract.provider_failure", { message });
    throw new LLMError("Extraction model call failed");
  }

  const { response } = outcome;
  const usage: ExtractionUsage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    attempts: outcome.attempts,
  };
  opts.onUsage?.(usage);
  logger.info("extract.completed", {
    durationMs: Date.now() - startedAt,
    stopReason: response.stop_reason,
    ...usage,
  });

  if (!outcome.ok) {
    // Bad model output is an upstream failure (502), not a client error.
    logger.error("extract.invalid_output", { issues: outcome.issues });
    throw new LLMError(`Extraction output failed validation: ${outcome.issues}`);
  }

  return outcome.data;
}
