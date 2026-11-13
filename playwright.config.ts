import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests for the flows no unit test can stand in for: editing the
 * output and reloading it, answering an open item, and generating a scope
 * before the questions are finished (UX-02).
 *
 * The server under test is `scripts/e2e-server.ts` — `next dev` against a
 * mock of the Gemini API and a throwaway PGlite database, so a run needs no
 * credentials and spends nothing.
 */

const PORT = Number(process.env.E2E_PORT ?? 3210);
// localhost, not 127.0.0.1: `next dev` treats the numeric host as a
// cross-origin caller and blocks its own dev resources.
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // A pipeline round plus two finalize jobs, on a cold dev-server compile.
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  // One at a time: the jobs run inside the dev server, and it is one process.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    actionTimeout: 20_000,
    // Local fallback when Playwright's managed browser download is
    // unavailable. CI continues to use the pinned managed browser.
    launchOptions: process.env.E2E_CHROME_PATH
      ? { executablePath: process.env.E2E_CHROME_PATH }
      : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx tsx scripts/e2e-server.ts",
    url: `${BASE_URL}/api/health`,
    // Reusing a developer server can silently route tests through live keys,
    // a real database and real GitHub. A busy port must fail loudly instead.
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
