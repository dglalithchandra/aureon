import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { defaultToolPayload, MOCK_TOOL_NAMES, type MockToolName } from "../fixtures/llm";

/**
 * In-process stand-in for the Anthropic Messages API (POST /v1/messages).
 *
 * Point the SDK at it with `process.env.ANTHROPIC_BASE_URL = mock.url` before
 * the first LLM call in a test file (lib/llm/anthropic.ts memoises its
 * client). The response is a single `tool_use` block for the tool named in
 * `tool_choice.name`, filled from tests/fixtures/llm.ts unless overridden.
 *
 * Per-test controls:
 *   setDelay(ms)            wait before answering every request
 *   failNext(n)             answer the next n HTTP requests with 529 overloaded.
 *                           The SDK retries twice (maxRetries: 2), so
 *                           failNext(3) makes one logical call fail.
 *   override(tool, payload) replace the fixture for a tool until reset()
 *   enqueue(tool, payload)  one-shot payload; queued payloads win over overrides
 *   reset()                 clear all of the above and the call log
 */

export interface RecordedCall {
  tool: string | null;
  model: string | null;
  /** Text of every user message, joined — for prompt assertions. */
  userText: string;
}

export interface MockAnthropic {
  readonly url: string;
  readonly calls: readonly RecordedCall[];
  callsFor(tool: MockToolName): RecordedCall[];
  setDelay(ms: number): void;
  failNext(count: number): void;
  override(tool: MockToolName, payload: unknown): void;
  enqueue(tool: MockToolName, payload: unknown): void;
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
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const parts: string[] = [];
  for (const m of messages) {
    if (!isObject(m) || m.role !== "user") continue;
    if (typeof m.content === "string") parts.push(m.content);
    else if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (isObject(block) && typeof block.text === "string") parts.push(block.text);
      }
    }
  }
  return parts.join("\n");
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

export async function startMockAnthropic(): Promise<MockAnthropic> {
  const calls: RecordedCall[] = [];
  const overrides = new Map<MockToolName, unknown>();
  const queues = new Map<MockToolName, unknown[]>();
  let delayMs = 0;
  let failRemaining = 0;
  let seq = 0;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) {
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

    const toolChoice = isObject(body.tool_choice) ? body.tool_choice : {};
    const tool = typeof toolChoice.name === "string" ? toolChoice.name : null;
    const model = typeof body.model === "string" ? body.model : null;
    calls.push({ tool, model, userText: userTextOf(body) });

    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    if (failRemaining > 0) {
      failRemaining--;
      // retry-after-ms keeps the SDK's retries instant instead of 0.5 s + 1 s.
      sendJson(res, 529, apiError("overloaded_error", "Overloaded"), {
        "retry-after-ms": "0",
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
    sendJson(res, 200, {
      id: `msg_mock_${seq}`,
      type: "message",
      role: "assistant",
      model: model ?? "mock",
      content: [{ type: "tool_use", id: `toolu_mock_${seq}`, name: tool, input }],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
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
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        // The SDK keeps sockets alive; drop them so close() resolves promptly.
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
