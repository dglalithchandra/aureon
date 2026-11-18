import { defineConfig, devices } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Browser tests for the flows no unit test can stand in for: editing the
 * output and reloading it, answering an open item, and generating a scope
 * before the questions are finished (UX-02).
 *
 * The server under test is `scripts/e2e-server.ts` — `next dev` against a
 * mock of the Gemini API and a throwaway PGlite database, so a run needs no
 * credentials and spends nothing.
 */

// A fresh port per invocation prevents a browser process from the preceding
// run briefly reconnecting to the new dev server's HMR channel on Windows.
// Put it in the parent environment so Playwright workers that reload this
// config inherit the same value. CI can still pin E2E_PORT explicitly.
process.env.E2E_PORT ??= String(43_000 + Math.floor(Math.random() * 1_000));
const PORT = Number(process.env.E2E_PORT);
// localhost, not 127.0.0.1: `next dev` treats the numeric host as a
// cross-origin caller and blocks its own dev resources.
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Keep write-heavy traces outside the repository. Turbopack watches the
  // project tree, and Playwright trace updates inside `test-results` can make
  // the dev server repeatedly reload the page under test on Windows.
  outputDir: join(tmpdir(), "aureon-playwright-results"),
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
    command: `npx tsx scripts/e2e-server.ts ${PORT}`,
    url: `${BASE_URL}/api/health`,
    // Reusing a developer server can silently route tests through live keys,
    // a real database and real GitHub. A busy port must fail loudly instead.
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
