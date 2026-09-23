import "@/lib/server-only";
import { getServerEnv } from "@/lib/env";
import {
  messageText,
  systemText,
  type JsonSchema,
  type LlmClient,
  type LlmContentBlock,
  type LlmRequest,
  type LlmResponse,
  type LlmStopReason,
  type LlmTool,
} from "@/lib/llm/types";

/**
 * Google Gemini, through the Interactions API.
 *
 *   POST {base}/v1beta/interactions       header x-goog-api-key
 *   body   model, system_instruction, input[], tools[], generation_config
 *   forced call  generation_config.tool_choice.allowed_tools
 *                { mode: "any", tools: ["<the one tool>"] }
 *   response     steps[] — the function_call step carries `arguments`
 *   usage        total_input_tokens / total_output_tokens / total_cached_tokens
 *
 * Two deliberate choices:
 *
 *   store: false — the client's requirement text is not kept on Google's
 *   servers between calls. The pipeline is stateless per call anyway; we
 *   send the whole context every time.
 *
 *   The tool schema is filtered down to the keywords the function-declaration
 *   format accepts (see sanitiseSchema). Whatever that drops is still
 *   enforced: every tool result is parsed by Zod, with one repair retry.
 */

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";

/** Per-attempt request deadline (ROB-01). A timed-out attempt is retried. */
export const GEMINI_TIMEOUT_MS = 45_000;

/** 429 is the free tier's per-minute limit; the 5xx family is transient. */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/** Total attempts per call, including the first. */
const ATTEMPTS = 3;

export class GeminiError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
  }
}

/* ──────────────────────────────────────────────────────────────
 *  Request
 * ────────────────────────────────────────────────────────────── */

/**
 * Keywords the function-declaration schema accepts. Everything else is
 * dropped rather than sent: an unsupported keyword (notably
 * `additionalProperties`, which our record-shaped fields use) makes the
 * whole request fail with 400, and the bound it expresses is re-checked by
 * Zod on the way back in.
 */
const ALLOWED_SCHEMA_KEYS = new Set([
  "type",
  "description",
  "enum",
  "items",
  "properties",
  "required",
  "nullable",
  "format",
  "minItems",
  "maxItems",
  "anyOf",
]);

/** A JSON Schema reduced to the keywords the API accepts. */
export function sanitiseSchema(schema: unknown): JsonSchema {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return {};
  }
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(schema as JsonSchema)) {
    if (!ALLOWED_SCHEMA_KEYS.has(key)) continue;
    if (key === "properties" && typeof value === "object" && value !== null) {
      const properties: JsonSchema = {};
      for (const [name, child] of Object.entries(value as JsonSchema)) {
        properties[name] = sanitiseSchema(child);
      }
      out.properties = properties;
    } else if (key === "items") {
      out.items = sanitiseSchema(value);
    } else if (key === "anyOf" && Array.isArray(value)) {
      out.anyOf = value.map(sanitiseSchema);
    } else {
      out[key] = value;
    }
  }
  // An object whose only shape was `additionalProperties` (a record) keeps
  // its type and description and is left free-form.
  return out;
}

interface GeminiFunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: JsonSchema;
}

function convertTools(tools: LlmTool[]): GeminiFunctionTool[] {
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: sanitiseSchema(tool.input_schema),
  }));
}

interface GeminiRequestBody {
  model: string;
  system_instruction?: string;
  input: Array<{ type: "user_input"; content: Array<{ type: "text"; text: string }> }>;
  tools?: GeminiFunctionTool[];
  generation_config: {
    max_output_tokens: number;
    temperature?: number;
    tool_choice?: { allowed_tools: { mode: "any"; tools: string[] } };
  };
  store: false;
}

export function buildRequestBody(params: LlmRequest): GeminiRequestBody {
  const system = systemText(params.system);
  const body: GeminiRequestBody = {
    model: params.model,
    input: params.messages.map((message) => ({
      type: "user_input" as const,
      content: [{ type: "text" as const, text: messageText(message) }],
    })),
    generation_config: {
      max_output_tokens: params.max_tokens,
      temperature: params.temperature ?? 0.2,
    },
    // The client's own words stay out of Google's stored history.
    store: false,
  };
  if (system) body.system_instruction = system;
  const tools = params.tools ?? [];
  if (tools.length > 0) {
    body.tools = convertTools(tools);
    // Forced call: the one tool the pipeline asked for, every time.
    const forced = params.tool_choice?.name ?? tools[0]!.name;
    body.generation_config.tool_choice = {
      allowed_tools: { mode: "any", tools: [forced] },
    };
  }
  return body;
}

/* ──────────────────────────────────────────────────────────────
 *  Response
 * ────────────────────────────────────────────────────────────── */

interface GeminiStep {
  type?: string;
  name?: string;
  id?: string;
  arguments?: unknown;
  content?: Array<{ type?: string; text?: string }>;
}

interface GeminiResponseBody {
  id?: string;
  model?: string;
  status?: string;
  steps?: GeminiStep[];
  output_text?: string;
  usage?: {
    total_input_tokens?: number;
    total_output_tokens?: number;
    total_cached_tokens?: number;
    total_thought_tokens?: number;
    total_tool_use_tokens?: number;
  };
}

/** `arguments` arrives parsed; a provider that sends JSON text still works. */
function toolInput(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function parseResponse(body: GeminiResponseBody, model: string): LlmResponse {
  const steps = Array.isArray(body.steps) ? body.steps : [];
  const content: LlmContentBlock[] = [];
  let calledTool = false;

  for (const step of steps) {
    if (step.type === "function_call" && typeof step.name === "string") {
      calledTool = true;
      content.push({
        type: "tool_use",
        id: step.id ?? `gem_${content.length}`,
        name: step.name,
        input: toolInput(step.arguments),
      });
      continue;
    }
    for (const block of step.content ?? []) {
      if (block.type === "text" && typeof block.text === "string" && block.text) {
        content.push({ type: "text", text: block.text });
      }
    }
  }
  if (content.length === 0 && typeof body.output_text === "string" && body.output_text) {
    content.push({ type: "text", text: body.output_text });
  }

  // "incomplete" is the truncation case callToolWithRepair retries with a
  // larger budget; anything else without a call is a plain answer.
  const stop_reason: LlmStopReason = calledTool
    ? "tool_use"
    : body.status === "incomplete"
      ? "max_tokens"
      : "end_turn";

  const usage = body.usage ?? {};
  return {
    id: body.id ?? "gemini",
    model: body.model ?? model,
    content,
    stop_reason,
    usage: {
      input_tokens: usage.total_input_tokens ?? 0,
      // Thinking tokens are billed as output, so they belong in this number.
      output_tokens: (usage.total_output_tokens ?? 0) + (usage.total_thought_tokens ?? 0),
      cache_read_input_tokens: usage.total_cached_tokens ?? 0,
      // Caching is implicit: nothing is ever written on request.
      cache_creation_input_tokens: 0,
    },
  };
}

/* ──────────────────────────────────────────────────────────────
 *  Transport
 * ────────────────────────────────────────────────────────────── */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Seconds from a Retry-After header, capped so one call cannot hang. */
function retryAfterMs(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(20_000, seconds * 1_000);
}

/** The message inside Google's error envelope, for the log. */
function errorMessage(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
      const error = (parsed as { error?: { message?: string; status?: string } }).error;
      if (error?.message) return `${error.status ?? ""} ${error.message}`.trim();
    }
  } catch {
    /* not JSON */
  }
  return text.slice(0, 300);
}

async function messagesCreate(params: LlmRequest): Promise<LlmResponse> {
  const env = getServerEnv();
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiError("GEMINI_API_KEY is not configured");

  const url = `${(env.GEMINI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "")}/v1beta/interactions`;
  const body = JSON.stringify(buildRequestBody(params));

  let lastError = "unknown error";
  let lastStatus: number | null = null;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "content-type": "application/json",
        },
        body,
        // Each attempt gets its own deadline, so one hung request cannot eat
        // the whole function budget.
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : "network failure";
      lastStatus = null;
      if (attempt < ATTEMPTS - 1) await sleep(backoff(attempt));
      continue;
    }

    if (res.ok) {
      const json = (await res.json()) as GeminiResponseBody;
      return parseResponse(json, params.model);
    }

    const text = await res.text().catch(() => "");
    lastStatus = res.status;
    lastError = errorMessage(text);
    if (!RETRYABLE_STATUS.has(res.status)) break;
    if (attempt < ATTEMPTS - 1) {
      await sleep(retryAfterMs(res) ?? backoff(attempt));
    }
  }

  const hint =
    lastStatus === 429
      ? " (the free tier's per-minute or per-day limit — wait, or slow the run down)"
      : "";
  throw new GeminiError(
    `Gemini request failed after ${ATTEMPTS} attempts: ${lastStatus ?? ""} ${lastError}${hint}`.trim(),
    lastStatus,
  );
}

/** 0.8s, 2s, then 4s, with jitter so parallel calls do not retry in lockstep. */
function backoff(attempt: number): number {
  const base = [800, 2_000, 4_000][attempt] ?? 4_000;
  return base + Math.floor(Math.random() * 400);
}

export const geminiClient: LlmClient = {
  messages: { create: messagesCreate },
};
