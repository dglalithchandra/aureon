# WO-01 — Test isolation completion report

Date: 2026-11-13

## Outcome

The automated and browser suites now run without reading `.env.local`, without reusing a
developer server, and without being able to contact non-loopback services. The browser pipeline
uses the in-process mock LLM and a disposable PGlite database.

## Changes

- `scripts/e2e-server.ts` scrubs application/service variables inherited from the shell, runs
  under Next's test environment so `.env.local` is ignored, and explicitly pins both LLM tiers to
  the local Gemini-compatible mock.
- `playwright.config.ts` refuses to reuse an existing server. A busy port now fails instead of
  silently testing a live developer process.
- `instrumentation.ts` installs a test-only outbound network guard when the E2E launcher requests
  it.
- `lib/testing/external-network-guard.ts` rejects every server-side `fetch` whose destination is
  not loopback.
- Unit tests prove OpenRouter is rejected before the delegated fetch runs and loopback requests
  remain available.
- `E2E_CHROME_PATH` provides a local fallback when Playwright's managed Chromium is unavailable.

## Verification

| Gate                        | Result                                               |
| --------------------------- | ---------------------------------------------------- |
| Unit/integration suite      | 71 files, 1,042 tests passed                         |
| TypeScript                  | passed                                               |
| ESLint                      | passed                                               |
| Playwright                  | 17 tests passed in 1.7 minutes                       |
| Full mocked generation      | passed; representative test completed in 6.5 seconds |
| GitHub during browser suite | zero requests reported for the fixture brief         |
| External fetch tripwire     | passed                                               |
| Real LLM credentials        | absent from the E2E child environment                |

The first Playwright attempt failed before test execution because the Playwright upgrade did not
have its matching managed Chromium binary. The managed download then stalled, so the successful
verification used the installed Google Chrome via `E2E_CHROME_PATH`. This is an environment setup
issue, not an application failure.

## Commands

```powershell
npm test
npm run typecheck
npm run lint
$env:E2E_CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
npx playwright test
```

## Boundary

This proves deterministic isolated behavior. It does not prove that live OpenRouter, Gemini,
GitHub, Postgres, Redis or QStash integrations are healthy; those require separately labelled live
diagnostics in later work orders.
