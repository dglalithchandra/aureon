import "@/lib/server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getServerEnv } from "@/lib/env";

/**
 * OpenRouter adapter that exposes a `messages.create` method shaped exactly
 * like Anthropic's SDK. Call sites in `lib/pipeline/*` and
 * `lib/github/extract-modules.ts` therefore work unchanged when the
 * provider is switched via `LLM_PROVIDER=openrouter`.
 *
 *   Anthropic forced tool-use  →  OpenAI function call (`tool_choice.function.name`)
 *   Anthropic system blocks    →  Concatenated string in OpenAI `role: "system"`
 *   OpenAI tool_call response  →  Synthetic Anthropic-shape `content: [{ type: "tool_use", ... }]`
 *
 * Free OpenRouter models are flaky on forced tool use — Llama sometimes
 * returns the JSON in `message.content` instead of `tool_calls`. We try
 * tool_calls first and fall back to a content-text JSON parse so the
 * pipeline doesn't crash on minor protocol drift.
 */

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

const DEFAULT_MODEL = "meta-llama/llama-3.3-70b-instruct:free";

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
}

/* ──────────────────────────────────────────────────────────────
 *  Conversion helpers
 * ────────────────────────────────────────────────────────────── */

interface AnthropicSystemBlock {
  type: "text";
  text: string;
  cache_control?: unknown;
}

function flattenSystem(
  system: string | AnthropicSystemBlock[] | undefined,
): string | null {
  if (!system) return null;
  if (typeof system === "string") return system;
  return system.map((b) => b.text).join("\n\n");
}

function flattenUserContent(content: Anthropic.MessageParam["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => {
      if (block.type === "text") return block.text;
      // tool_use / tool_result / image — flatten to a labeled placeholder.
      return `[${block.type}]`;
    })
    .join("\n\n");
}

function convertTools(tools: Anthropic.Tool[] | undefined): OpenAiTool[] {
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

function convertToolChoice(
  choice: Anthropic.MessageCreateParams["tool_choice"],
): unknown {
  if (!choice) return undefined;
  if (choice.type === "tool") {
    return { type: "function", function: { name: choice.name } };
  }
  if (choice.type === "any") return "required";
  if (choice.type === "auto") return "auto";
  return undefined;
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

/* ──────────────────────────────────────────────────────────────
 *  Resilient fetch — retry transient failures with backoff + jitter
 * ────────────────────────────────────────────────────────────── */

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
      const res = await fetch(url, init);
      if (res.ok || !RETRYABLE_STATUS.has(res.status)) return res;
      // Retryable status — consume body so the socket frees, then back off.
      await res.text().catch(() => undefined);
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
 *  Public API — Anthropic-shape `messages.create`
 * ────────────────────────────────────────────────────────────── */

async function messagesCreate(
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  const env = getServerEnv();
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }
  const model = env.OPENROUTER_MODEL ?? DEFAULT_MODEL;

  const messages: OpenAiMessage[] = [];
  const sys = flattenSystem(params.system as string | AnthropicSystemBlock[] | undefined);
  if (sys) messages.push({ role: "system", content: sys });

  for (const m of params.messages) {
    messages.push({
      role: m.role,
      content: flattenUserContent(m.content),
    });
  }

  const body = {
    model,
    max_tokens: params.max_tokens,
    temperature: 0.2,
    messages,
    tools: convertTools(params.tools as Anthropic.Tool[] | undefined),
    tool_choice: convertToolChoice(params.tool_choice),
  };

  // The raw fetch has no built-in retry (unlike the Anthropic SDK). Free
  // OpenRouter routes drop connections often and rate-limit upstream, so we
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
    throw new Error("OpenRouter returned no choices");
  }

  // Build the Anthropic-shape content blocks. We map every tool_call to a
  // tool_use block; if the model ignored tool_choice and returned plain
  // content text, we attempt one JSON recovery before falling back to the
  // text being surfaced as a text block (caller will treat as a parse fail).
  const content: Anthropic.ContentBlock[] = [];

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
      } as Anthropic.ContentBlock);
    }
  } else {
    const recovered = recoverToolJson(message.content);
    const expectedTool = params.tools?.[0]?.name;
    if (recovered && expectedTool) {
      content.push({
        type: "tool_use",
        id: cryptoRandomId(),
        name: expectedTool,
        input: recovered,
      } as Anthropic.ContentBlock);
    } else if (message.content) {
      content.push({
        type: "text",
        text: message.content,
        citations: null,
      } as Anthropic.ContentBlock);
    }
  }

  const usage: Anthropic.Usage = {
    input_tokens: data.usage?.prompt_tokens ?? 0,
    output_tokens: data.usage?.completion_tokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    server_tool_use: null,
    service_tier: null,
  } as unknown as Anthropic.Usage;

  return {
    id: data.id ?? cryptoRandomId(),
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: choice?.finish_reason === "tool_calls" ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage,
    container: null,
  } as unknown as Anthropic.Message;
}

function cryptoRandomId(): string {
  // Cheap unique id for content blocks (no security significance).
  return `or_${Math.random().toString(36).slice(2, 12)}`;
}

/* Adapter object that mirrors `new Anthropic({...})` surface used by the app. */
export const openRouterClient = {
  messages: {
    create: messagesCreate,
  },
};
