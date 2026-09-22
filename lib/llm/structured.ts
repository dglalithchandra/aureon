import "@/lib/server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { createLlmMessage } from "@/lib/llm/anthropic";
import { logger } from "@/lib/logger";

/**
 * Forced tool call with validation and one-shot repair (ROB-01):
 *
 *   1. stop_reason "max_tokens" (truncated output) → retry once with a 1.5x
 *      max_tokens budget.
 *   2. No tool call, or the tool input fails validation → retry once, adding a
 *      user message that lists the problems so the model can fix them.
 *
 * Transport errors (SDK / HTTP / budget) propagate to the caller unchanged.
 * The caller decides what an invalid result means (fail the round, or fall
 * back to an empty answer).
 */

type Issue = { path: PropertyKey[]; message: string };
type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: { issues: Issue[] } };

export type ToolCallOutcome<T> =
  | { ok: true; data: T; response: Anthropic.Message; attempts: number }
  | { ok: false; issues: string; response: Anthropic.Message; attempts: number };

export interface ToolCallOptions<T> {
  /** Must force the tool: tool_choice { type: "tool", name: toolName }. */
  params: Anthropic.MessageCreateParamsNonStreaming;
  toolName: string;
  /** Validate the tool input, e.g. `(x) => Schema.safeParse(coerce(x))`. */
  parse: (input: unknown) => ParseResult<T>;
  /** Log prefix, e.g. "extract". */
  label: string;
}

const MAX_ISSUES = 8;

export async function callToolWithRepair<T>(
  opts: ToolCallOptions<T>,
): Promise<ToolCallOutcome<T>> {
  let params = opts.params;
  let attempts = 1;
  let response = await createLlmMessage(params);

  if (response.stop_reason === "max_tokens") {
    params = { ...params, max_tokens: Math.ceil(params.max_tokens * 1.5) };
    logger.warn(`${opts.label}.max_tokens_retry`, { maxTokens: params.max_tokens });
    attempts++;
    response = await createLlmMessage(params);
  }

  const first = validate(response, opts);
  if (first.ok) return { ...first, response, attempts };

  logger.warn(`${opts.label}.repair_retry`, { issues: first.issues });
  attempts++;
  response = await createLlmMessage({
    ...params,
    messages: [
      ...params.messages,
      { role: "user", content: repairInstruction(opts.toolName, first.issues) },
    ],
  });
  const second = validate(response, opts);
  return { ...second, response, attempts };
}

function validate<T>(
  response: Anthropic.Message,
  opts: ToolCallOptions<T>,
): { ok: true; data: T } | { ok: false; issues: string } {
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === opts.toolName,
  );
  if (!toolUse) {
    return { ok: false, issues: `the response did not call ${opts.toolName}` };
  }
  const parsed = opts.parse(toolUse.input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issues = parsed.error.issues
    .slice(0, MAX_ISSUES)
    .map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return { ok: false, issues };
}

function repairInstruction(toolName: string, issues: string): string {
  return [
    `Your previous ${toolName} call was rejected by validation:`,
    ...issues.split("; ").map((i) => `- ${i}`),
    `Call ${toolName} again with a complete, corrected input. Keep everything else the same.`,
  ].join("\n");
}
