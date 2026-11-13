import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
// Keep the write-heavy disposable database outside the repository. Turbopack
// watches the project tree, so a PGlite directory inside it repeatedly wakes
// the file watcher and can turn a sub-second mocked request into minutes.
const PGLITE_DIR = join(tmpdir(), "aureon-pglite-e2e");

// Do not pass application configuration or credentials from the developer's
// shell into the browser-test server. NODE_ENV=test also makes Next ignore
// .env.local, so deleting these values is sufficient even when that file
// contains live keys (see Next's environment-variable load order).
const APP_ENV_KEYS = [
  "ALLOW_FREE_MODELS",
  "ALLOW_MEMORY_STORE",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "AUTH_SECRET",
  "AUTH_URL",
  "CRON_SECRET",
  "DATABASE_URL",
  "EMAIL_API_KEY",
  "EMAIL_API_URL",
  "EMAIL_FROM",
  "GEMINI_API_KEY",
  "GEMINI_BASE_URL",
  "GEMINI_FAST_MODEL",
  "GEMINI_MODEL",
  "GITHUB_TOKEN",
  "JOBS_BASE_URL",
  "LLM_DAILY_CALL_LIMIT",
  "LLM_FALLBACK_PROVIDER",
  "LLM_FAST_PROVIDER",
  "LLM_MAIN_PROVIDER",
  "LLM_PROVIDER",
  "OPENROUTER_API_KEY",
  "OPENROUTER_FAST_API_KEY",
  "OPENROUTER_FAST_MODEL",
  "OPENROUTER_MAIN_API_KEY",
  "OPENROUTER_MODEL",
  "QSTASH_CURRENT_SIGNING_KEY",
  "QSTASH_NEXT_SIGNING_KEY",
  "QSTASH_TOKEN",
  "QSTASH_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
] as const;

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

  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of APP_ENV_KEYS) delete env[key];
  Object.assign(env, {
    NODE_ENV: "test",
    PGLITE_DIR,
    E2E_BLOCK_EXTERNAL_NETWORK: "1",
    LLM_PROVIDER: "gemini",
    LLM_MAIN_PROVIDER: "gemini",
    LLM_FAST_PROVIDER: "gemini",
    GEMINI_API_KEY: "test-key-not-a-real-credential",
    GEMINI_MODEL: "gemini-e2e-main",
    GEMINI_FAST_MODEL: "gemini-e2e-fast",
    GEMINI_BASE_URL: mock.url,
    SESSION_SECRET: "e2e-session-secret-e2e-session-secret",
    NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${PORT}`,
  });

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
