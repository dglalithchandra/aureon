/**
 * Runs before every test file (vitest `setupFiles`).
 *
 *   1. Pins a deterministic, credential-free environment so a developer's
 *      shell or `.env.local` can never route a test to a paid API.
 *   2. Replaces global `fetch` with a guard that only allows loopback hosts.
 *      The Anthropic SDK, Octokit and Upstash all use global fetch, so any
 *      accidental real network call fails loudly instead of spending money.
 */

const TEST_ENV: Record<string, string> = {
  LLM_PROVIDER: "anthropic",
  ANTHROPIC_API_KEY: "sk-ant-test-0000000000000000000000",
  // Tests that need the LLM start tests/mocks/mock-anthropic.ts and point
  // this at it. Port 9 (discard) makes a forgotten mock fail fast.
  ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
  SESSION_SECRET: "test-session-secret-0123456789abcdef",
};

const UNSET = [
  "ANTHROPIC_AUTH_TOKEN",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "GITHUB_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
];

for (const [key, value] of Object.entries(TEST_ENV)) process.env[key] = value;
for (const key of UNSET) delete process.env[key];

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const realFetch = globalThis.fetch;

function requestUrl(input: Parameters<typeof fetch>[0]): URL {
  if (typeof input === "string") return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

globalThis.fetch = (input, init) => {
  const url = requestUrl(input);
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    return Promise.reject(
      new Error(`Network access is blocked in tests (attempted ${url.origin})`),
    );
  }
  return realFetch(input, init);
};
