import "@/lib/server-only";
import { getServerEnv } from "@/lib/env";
import {
  messageText,
  systemText,
  type LlmClient,
  type LlmContentBlock,
  type LlmRequest,
  type LlmResponse,
  type LlmStopReason,
  type LlmTool,
} from "@/lib/llm/types";

/**
 * OpenRouter adapter. It speaks the shape in lib/llm/types.ts, so
 * `lib/pipeline/*` and `lib/github/extract-modules.ts` work unchanged when
 * the provider is switched with LLM_PROVIDER=openrouter.
 *
 *   forced tool use  →  OpenAI function call (`tool_choice.function.name`)
 *   system blocks    →  one string in OpenAI `role: "system"`
 *   tool_call reply  →  `content: [{ type: "tool_use", ... }]`
 *
 * Free OpenRouter models are flaky on forced tool use — Llama sometimes
 * returns the JSON in `message.content` instead of `tool_calls`. We try
 * tool_calls first and fall back to a content-text JSON parse so the
 * pipeline doesn't crash on minor protocol drift.
 */

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

// A pinned free model is more deterministic than `openrouter/free`, which can
// select a different provider for the repair retry. This model advertises both
// forced tool choice and structured-output support in OpenRouter's model API.
const DEFAULT_MODEL = "baidu/ernie-5.5-flash-preview:free";

interface OpenAiTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: unknown;
  };
}

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id?: string;
    type?: "function";
    function: { name: string; arguments: string };
  }>;
}

interface OpenAiResponse {
  id?: string;
  choices?: Array<{
    finish_reason?: string;
    message?: OpenAiMessage;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: {
    code?: number | string;
    message?: string;
  };
}

/* ──────────────────────────────────────────────────────────────
 *  Conversion helpers
 * ────────────────────────────────────────────────────────────── */

function convertTools(tools: LlmTool[] | undefined): OpenAiTool[] {
  if (!tools) return [];
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

function convertToolChoice(choice: LlmRequest["tool_choice"] | undefined): unknown {
  if (!choice) return undefined;
  return { type: "function", function: { name: choice.name } };
}

/**
 * Try hard to extract a JSON tool-call payload from a model response that
 * may have ignored the strict tool-use protocol. Returns null when no
 * sensible JSON object can be recovered.
 */
function recoverToolJson(text: string | null | undefined): unknown {
  if (!text) return null;
  // First try: the entire content is JSON.
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* try a fenced block next */
  }
  // Look for a ```json fenced block.
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      /* fall through */
    }
  }
  // Last attempt: locate the first balanced { ... } block.
  const start = trimmed.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Some OpenRouter free models print an OpenAI-style tool-call envelope in
 * `message.content` instead of populating `message.tool_calls`. Unwrap the
 * common envelopes before handing the input to the pipeline schema.
 */
function unwrapRecoveredToolInput(value: unknown, expectedTool: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;

  if (record.name === expectedTool && "arguments" in record) {
    return parseJsonString(record.arguments);
  }

  const fn = record.function;
  if (fn && typeof fn === "object" && !Array.isArray(fn)) {
    const functionRecord = fn as Record<string, unknown>;
    if (functionRecord.name === expectedTool && "arguments" in functionRecord) {
      return parseJsonString(functionRecord.arguments);
    }
  }

  const calls = record.tool_calls;
  if (Array.isArray(calls)) {
    for (const call of calls) {
      if (!call || typeof call !== "object" || Array.isArray(call)) continue;
      const callRecord = call as Record<string, unknown>;
      const callFn = callRecord.function;
      if (!callFn || typeof callFn !== "object" || Array.isArray(callFn)) continue;
      const functionRecord = callFn as Record<string, unknown>;
      if (functionRecord.name === expectedTool && "arguments" in functionRecord) {
        return parseJsonString(functionRecord.arguments);
      }
    }
  }

  if (expectedTool in record) return parseJsonString(record[expectedTool]);
  return value;
}

function parseJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/* ──────────────────────────────────────────────────────────────
 *  Resilient fetch — retry transient failures with backoff + jitter
 * ────────────────────────────────────────────────────────────── */

/** Per-attempt request timeout (ROB-01). Timed-out attempts are retried. */
export const OPENROUTER_TIMEOUT_MS = 45_000;

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 520, 522, 524]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * fetch() that retries on network errors ("fetch failed", ECONNRESET, DNS
 * blips) and retryable HTTP statuses. Non-retryable client errors
 * (400/401/403/404) and the final attempt's failure bubble up immediately.
 *
 * Backoff: 0.6s, 1.4s, 3s (+ up to 400ms jitter). With `attempts=4` the
 * total worst-case added latency is ~5s before failing — acceptable for a
 * pipeline that already takes 60-90s, and it absorbs the common single
 * upstream blip that was killing whole sessions.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts: number,
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      // Each attempt gets its own deadline, so one hung upstream cannot eat
      // the whole function budget.
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
      });
      // Read the body inside the retry boundary. A provider can send headers
      // and then stall while streaming the body; that timeout must be retried
      // just like a timeout waiting for headers.
      const text = await res.text();
      if (res.ok || !RETRYABLE_STATUS.has(res.status)) {
        return new Response(text, { status: res.status, headers: res.headers });
      }
      lastErr = new Error(`OpenRouter ${res.status}`);
    } catch (err) {
      lastErr = err; // network-level failure ("fetch failed")
    }
    if (i < attempts - 1) {
      const base = [600, 1400, 3000][i] ?? 3000;
      await sleep(base + Math.floor(Math.random() * 400));
    }
  }
  throw new Error(
    `OpenRouter request failed after ${attempts} attempts: ${
      lastErr instanceof Error ? lastErr.message : "unknown"
    }`,
  );
}

/* ──────────────────────────────────────────────────────────────
 *  Public API — `messages.create`
 * ────────────────────────────────────────────────────────────── */

async function messagesCreate(params: LlmRequest): Promise<LlmResponse> {
  const env = getServerEnv();
  const apiKey =
    params.tier === "fast"
      ? (env.OPENROUTER_FAST_API_KEY ?? env.OPENROUTER_API_KEY)
      : (env.OPENROUTER_MAIN_API_KEY ?? env.OPENROUTER_API_KEY);
  if (!apiKey) {
    throw new Error(`OpenRouter ${params.tier ?? "main"} API key is not configured`);
  }
  const model = params.model || env.OPENROUTER_MODEL || DEFAULT_MODEL;

  const messages: OpenAiMessage[] = [];
  const sys = systemText(params.system);
  if (sys) messages.push({ role: "system", content: sys });

  for (const m of params.messages) {
    messages.push({ role: m.role, content: messageText(m) });
  }

  const body = {
    model,
    max_tokens: params.max_tokens,
    temperature: params.temperature ?? 0.2,
    // The pipeline needs a validated tool payload, not a long hidden chain of
    // thought. Disabling optional reasoning keeps free models within the
    // request deadline and leaves more output budget for the tool arguments.
    reasoning_effort: "none",
    messages,
    tools: convertTools(params.tools),
    tool_choice: convertToolChoice(params.tool_choice),
    // Do not silently route to an endpoint that drops tool_choice or tools.
    provider: { require_parameters: true },
  };

  // Free OpenRouter routes drop connections often and rate-limit upstream, so we
  // retry transient failures with exponential backoff + jitter. Only
  // non-retryable HTTP statuses (400/401/403/404) fail fast.
  const res = await fetchWithRetry(
    ENDPOINT,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://aureon.local",
        "X-Title": "Aureon",
      },
      body: JSON.stringify(body),
    },
    4,
  );

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${txt.slice(0, 240)}`);
  }

  const data = (await res.json()) as OpenAiResponse;
  const choice = data.choices?.[0];
  const message = choice?.message;
  if (!message) {
    const detail = data.error?.message?.trim();
    throw new Error(detail ? `OpenRouter returned no choices: ${detail}` : "OpenRouter returned no choices");
  }

  // Build the content blocks. We map every tool_call to a
  // tool_use block; if the model ignored tool_choice and returned plain
  // content text, we attempt one JSON recovery before falling back to the
  // text being surfaced as a text block (caller will treat as a parse fail).
  const content: LlmContentBlock[] = [];

  if (message.tool_calls && message.tool_calls.length > 0) {
    for (const tc of message.tool_calls) {
      let input: unknown = {};
      try {
        input = JSON.parse(tc.function.arguments || "{}");
      } catch {
        input = {};
      }
      content.push({
        type: "tool_use",
        id: tc.id ?? cryptoRandomId(),
        name: tc.function.name,
        input,
      });
    }
  } else {
    const recovered = recoverToolJson(message.content);
    const expectedTool = params.tools?.[0]?.name;
    if (recovered && expectedTool) {
      content.push({
        type: "tool_use",
        id: cryptoRandomId(),
        name: expectedTool,
        input: unwrapRecoveredToolInput(recovered, expectedTool),
      });
    } else if (message.content) {
      content.push({ type: "text", text: message.content });
    }
  }

  return {
    id: data.id ?? cryptoRandomId(),
    model,
    content,
    stop_reason: toStopReason(choice?.finish_reason),
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  };
}

/**
 * OpenAI finish_reason → our stop reason. "length" must become "max_tokens"
 * so callers can tell truncated output from invalid output.
 */
function toStopReason(finishReason: string | undefined): LlmStopReason {
  if (finishReason === "tool_calls") return "tool_use";
  if (finishReason === "length") return "max_tokens";
  return "end_turn";
}

function cryptoRandomId(): string {
  // Cheap unique id for content blocks (no security significance).
  return `or_${Math.random().toString(36).slice(2, 12)}`;
}

export const openRouterClient: LlmClient = {
  messages: { create: messagesCreate },
};
