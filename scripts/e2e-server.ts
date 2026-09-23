import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { startMockLlm, type MockLlm } from "../tests/mocks/mock-llm";
import { MOCK_TOOL_NAMES, type MockToolName } from "../tests/fixtures/llm";

/**
 * The app as the browser tests see it (UX-02's Playwright suite).
 *
 * `next dev` with two substitutions, so nothing in the run costs money or
 * needs an account:
 *   - GEMINI_BASE_URL points at the in-process mock of the Interactions API,
 *     the same fixtures the unit tests use;
 *   - no DATABASE_URL, so instrumentation.ts starts PGlite — in its own
 *     directory, wiped first, so every run begins with an empty database.
 *
 * Playwright starts this through `webServer` in playwright.config.ts.
 */

const PORT = process.env.E2E_PORT ?? "3210";
const CONTROL_PORT = Number(process.env.E2E_CONTROL_PORT ?? 3211);
const PGLITE_DIR = ".pglite-e2e";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function isToolName(value: unknown): value is MockToolName {
  return (
    typeof value === "string" && (MOCK_TOOL_NAMES as readonly string[]).includes(value)
  );
}

/**
 * POST /override {tool, payload} — what the mock answers for that tool from
 * now on. POST /reset clears every override. Test-only, on its own port,
 * bound to loopback.
 */
function startControl(mock: MockLlm): void {
  createServer((req, res) => {
    void (async () => {
      try {
        if (req.method === "POST" && req.url === "/reset") {
          mock.reset();
          res.writeHead(204).end();
          return;
        }
        if (req.method === "POST" && req.url === "/override") {
          const body = JSON.parse(await readBody(req)) as {
            tool?: unknown;
            payload?: unknown;
          };
          if (!isToolName(body.tool)) {
            res.writeHead(400).end("unknown tool");
            return;
          }
          mock.override(body.tool, body.payload);
          res.writeHead(204).end();
          return;
        }
        res.writeHead(404).end();
      } catch (err) {
        res.writeHead(500).end(err instanceof Error ? err.message : "error");
      }
    })();
  }).listen(CONTROL_PORT, "127.0.0.1", () => {
    process.stdout.write(`[e2e] control on http://127.0.0.1:${CONTROL_PORT}\n`);
  });
}

async function main(): Promise<void> {
  rmSync(PGLITE_DIR, { recursive: true, force: true });
  const mock = await startMockLlm();
  process.stdout.write(`[e2e] mock LLM on ${mock.url}\n`);
  startControl(mock);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "development",
    PGLITE_DIR,
    LLM_PROVIDER: "gemini",
    GEMINI_API_KEY: "test-key-not-a-real-credential",
    GEMINI_BASE_URL: mock.url,
    SESSION_SECRET: "e2e-session-secret-e2e-session-secret",
    NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${PORT}`,
  };
  // Deleted, not blanked: the environment schema reads an empty string as a
  // malformed value and refuses to start. Without a database there is PGlite,
  // and without QStash the jobs run inline (lib/jobs/transport).
  for (const key of [
    "DATABASE_URL",
    "QSTASH_TOKEN",
    "QSTASH_URL",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
  ]) {
    delete env[key];
  }

  const child = spawn("npx", ["next", "dev", "--port", PORT], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env,
  });

  const stop = (): void => {
    child.kill();
    void mock.close();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code) => {
    void mock.close().then(() => process.exit(code ?? 0));
  });
}

void main();
