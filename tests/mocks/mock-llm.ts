import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { defaultToolPayload, MOCK_TOOL_NAMES, type MockToolName } from "../fixtures/llm";

/**
 * In-process stand-in for the Gemini Interactions API
 * (POST /v1beta/interactions).
 *
 * Point the client at it with `process.env.GEMINI_BASE_URL = mock.url` before
 * the first LLM call in a test file (lib/llm/client.ts memoises the adapter).
 * The reply is one `function_call` step for the tool the request forced,
 * filled from tests/fixtures/llm.ts unless overridden.
 *
 * Per-test controls:
 *   setDelay(ms)            wait before answering every request
 *   failNext(n)             answer the next n HTTP requests with 429
 *                           RESOURCE_EXHAUSTED. The client retries twice, so
 *                           failNext(3) makes one logical call fail.
 *   override(tool, payload) replace the fixture for a tool until reset()
 *   enqueue(tool, payload)  one-shot payload; queued payloads win over overrides
 *   truncateNext(n)         answer the next n requests with status
 *                           "incomplete" and no tool call (truncated output)
 *   reset()                 clear all of the above and the call log
 */

export interface RecordedCall {
  tool: string | null;
  model: string | null;
  maxTokens: number | null;
  /** Text of every user message, joined — for prompt assertions. */
  userText: string;
}

export interface MockLlm {
  readonly url: string;
  readonly calls: readonly RecordedCall[];
  callsFor(tool: MockToolName): RecordedCall[];
  setDelay(ms: number): void;
  failNext(count: number): void;
  override(tool: MockToolName, payload: unknown): void;
  enqueue(tool: MockToolName, payload: unknown): void;
  truncateNext(count: number): void;
  reset(): void;
  close(): Promise<void>;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMockToolName(value: string): value is MockToolName {
  return (MOCK_TOOL_NAMES as readonly string[]).includes(value);
}

function userTextOf(body: JsonObject): string {
  const input = Array.isArray(body.input) ? body.input : [];
  const parts: string[] = [];
  for (const step of input) {
    if (!isObject(step)) continue;
    if (typeof step.content === "string") parts.push(step.content);
    else if (Array.isArray(step.content)) {
      for (const block of step.content) {
        if (isObject(block) && typeof block.text === "string") parts.push(block.text);
      }
    }
  }
  return parts.join("\n");
}

/** The tool the request forced, from generation_config.tool_choice. */
function forcedToolOf(body: JsonObject): string | null {
  const config = isObject(body.generation_config) ? body.generation_config : {};
  const choice = isObject(config.tool_choice) ? config.tool_choice : {};
  const allowed = isObject(choice.allowed_tools) ? choice.allowed_tools : {};
  const tools = Array.isArray(allowed.tools) ? allowed.tools : [];
  const first = tools[0];
  return typeof first === "string" ? first : null;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function apiError(type: string, message: string): JsonObject {
  return { type: "error", error: { type, message } };
}

export async function startMockLlm(): Promise<MockLlm> {
  const calls: RecordedCall[] = [];
  const overrides = new Map<MockToolName, unknown>();
  const queues = new Map<MockToolName, unknown[]>();
  let delayMs = 0;
  let failRemaining = 0;
  let truncateRemaining = 0;
  let seq = 0;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST" || !req.url?.startsWith("/v1beta/interactions")) {
      sendJson(
        res,
        404,
        apiError("not_found_error", `No mock for ${req.method} ${req.url}`),
      );
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, apiError("invalid_request_error", "Body is not JSON"));
      return;
    }
    if (!isObject(body)) {
      sendJson(res, 400, apiError("invalid_request_error", "Body must be an object"));
      return;
    }

    const tool = forcedToolOf(body);
    const model = typeof body.model === "string" ? body.model : null;
    const config = isObject(body.generation_config) ? body.generation_config : {};
    const maxTokens =
      typeof config.max_output_tokens === "number" ? config.max_output_tokens : null;
    calls.push({ tool, model, maxTokens, userText: userTextOf(body) });

    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    if (failRemaining > 0) {
      failRemaining--;
      // retry-after: 0 keeps the client's backoff instant in tests.
      sendJson(res, 429, apiError("RESOURCE_EXHAUSTED", "Quota exceeded"), {
        "retry-after": "0",
      });
      return;
    }

    if (!tool || !isMockToolName(tool)) {
      sendJson(
        res,
        400,
        apiError("invalid_request_error", `Mock has no fixture for tool_choice ${tool}`),
      );
      return;
    }

    const queued = queues.get(tool);
    const input =
      queued && queued.length > 0
        ? queued.shift()
        : overrides.has(tool)
          ? overrides.get(tool)
          : defaultToolPayload(tool);

    seq++;
    if (truncateRemaining > 0) {
      truncateRemaining--;
      // "incomplete" is how the API reports output cut off at the token
      // budget: no function_call step ever arrives.
      sendJson(res, 200, {
        id: `int_mock_${seq}`,
        model: model ?? "mock",
        status: "incomplete",
        steps: [],
        usage: {
          total_input_tokens: 100,
          total_output_tokens: maxTokens ?? 0,
        },
      });
      return;
    }
    sendJson(res, 200, {
      id: `int_mock_${seq}`,
      model: model ?? "mock",
      status: "completed",
      steps: [
        {
          type: "function_call",
          id: `call_mock_${seq}`,
          name: tool,
          arguments: input,
        },
      ],
      usage: {
        total_input_tokens: 100,
        total_output_tokens: 50,
        total_cached_tokens: 0,
        total_thought_tokens: 0,
      },
    });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "mock failure";
      if (!res.headersSent) sendJson(res, 500, apiError("api_error", message));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    callsFor: (tool) => calls.filter((c) => c.tool === tool),
    setDelay: (ms) => {
      delayMs = ms;
    },
    failNext: (count) => {
      failRemaining = count;
    },
    override: (tool, payload) => {
      overrides.set(tool, payload);
    },
    truncateNext: (count) => {
      truncateRemaining = count;
    },
    enqueue: (tool, payload) => {
      const q = queues.get(tool) ?? [];
      q.push(payload);
      queues.set(tool, q);
    },
    reset: () => {
      calls.length = 0;
      overrides.clear();
      queues.clear();
      delayMs = 0;
      failRemaining = 0;
      truncateRemaining = 0;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        // The SDK keeps sockets alive; drop them so close() resolves promptly.
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
