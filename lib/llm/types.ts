/**
 * Aureon's own LLM request/response shape.
 *
 * Every pipeline call is the same thing: a system prompt, one user message,
 * one tool the model MUST call, and a JSON object back. This file is that
 * contract. Providers adapt to it — `lib/llm/gemini.ts` speaks Google's
 * Interactions API, `lib/llm/openrouter.ts` speaks OpenAI's chat completions
 * — so nothing in `lib/pipeline/*` knows which model answered.
 *
 * The shape is deliberately close to the one the project started with, so
 * the call sites and the fixtures did not have to be rewritten when the
 * provider changed. Client-safe types only; no SDK imports.
 */

/** A JSON Schema object describing a tool's input. */
export type JsonSchema = Record<string, unknown>;

/** Cost/quality class used by the provider router. */
export type LlmTier = "main" | "fast";

export interface LlmTool {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

export interface LlmTextBlock {
  type: "text";
  text: string;
}

export interface LlmToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  /** The tool input, already parsed from JSON. Validate before trusting it. */
  input: unknown;
}

export type LlmContentBlock = LlmTextBlock | LlmToolUseBlock;

export interface LlmMessage {
  role: "user" | "assistant";
  content: string | LlmContentBlock[];
}

/** The system prompt: one string, or blocks (kept for prompt readability). */
export type LlmSystem = string | LlmTextBlock[];

export interface LlmRequest {
  /** Provider model id, from promptModel(). */
  model: string;
  /** Defaults to main for backward compatibility with direct callers. */
  tier?: LlmTier;
  max_tokens: number;
  system?: LlmSystem;
  tools?: LlmTool[];
  /** Forced tool use is the only mode the pipeline uses. */
  tool_choice?: { type: "tool"; name: string };
  messages: LlmMessage[];
  temperature?: number;
}

/**
 * Why the model stopped. "tool_use" is the happy path; "max_tokens" triggers
 * the larger-budget retry in callToolWithRepair.
 */
export type LlmStopReason = "tool_use" | "end_turn" | "max_tokens" | "other";

export interface LlmUsage {
  input_tokens: number;
  output_tokens: number;
  /** Tokens served from the provider's cache, when it reports them. */
  cache_read_input_tokens: number;
  /** Tokens written to a cache. Providers that cache implicitly report 0. */
  cache_creation_input_tokens: number;
}

export interface LlmResponse {
  id: string;
  model: string;
  content: LlmContentBlock[];
  stop_reason: LlmStopReason;
  usage: LlmUsage;
}

/** What every provider adapter must expose. */
export interface LlmClient {
  messages: {
    create: (params: LlmRequest) => Promise<LlmResponse>;
  };
}

/** The system prompt as one string, whichever form it arrived in. */
export function systemText(system?: LlmSystem): string {
  if (!system) return "";
  return typeof system === "string"
    ? system
    : system
        .map((block) => block.text)
        .join("\n\n")
        .trim();
}

/** The text of a user/assistant message, whichever form it arrived in. */
export function messageText(message: LlmMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n\n");
}
