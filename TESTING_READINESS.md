# Aureon testing readiness and configuration

Reviewed: 9 October 2026
Repository: C:\Users\D Lalith Chandra\Desktop\scopeai

## What this project builds

Aureon is a project-scoping assistant. A client types an idea or imports requirements; the server extracts the scope, detects its domain, searches related public GitHub repositories, asks targeted clarification questions, and generates two editable documents: a client scope and an engineer implementation scope.

The pipeline checks nine areas: project goal, target users, core features, technical constraints, integrations, non-functional requirements, budget, timeline, and success criteria. Confidence, blocker gates, module merging, risk detection and effort estimates use server logic; extraction, question wording, README module mining and document wording use the model.

Implemented surrounding features include projects, accounts/workspaces, version history and comparisons, approval/share links, Markdown/PDF/DOCX/Jira CSV/Linear CSV exports, recording actual effort, and calibration after enough completed projects. There is no embedding/vector service, two-way Jira/Linear/Notion sync, live document collaboration or billing implementation. Those services do not need API keys for this application's current features. A payment provider mentioned inside a client brief is input to scoping, not a payment integration in Aureon.

Important implementation locations:

- lib/env.ts: validated server configuration.
- instrumentation.ts: startup and the local PGlite fallback.
- lib/pipeline/orchestrator.ts: extraction/clarification flow.
- lib/pipeline/finalize.ts: client/engineer output, risks and effort.
- lib/auth/auth.ts: Google and email login.
- lib/jobs/transport.ts: QStash or local after() job delivery.
- lib/storage/session.ts and lib/db/schema.ts: projects/rounds persisted in Postgres.
- tests/: unit, integration and browser suites.
- evals/: 30 labelled cases and real/mock evaluation runners.

## Current configuration, without secret values

The existing .env.local contains these five settings:

- LLM_PROVIDER=openrouter
- OPENROUTER_MODEL=openrouter/free
- OPENROUTER_API_KEY: populated; provider validity not checked.
- SESSION_SECRET: populated; retained unchanged.
- NEXT_PUBLIC_APP_URL=http://localhost:3500

The file is ignored by Git and was not found in the tracked file list. No credentials were changed or disclosed during this review.

No Gemini, GitHub, hosted Postgres, Google OAuth, email API, Upstash Redis or QStash credentials are configured in this file. Shell/deployment-specific settings can differ.

## What you need to supply

| Feature/testing stage                    | Exact settings                                                    | What you provide                                                                    | Required locally?                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Real AI, existing provider               | LLM_PROVIDER=openrouter, OPENROUTER_API_KEY, OPENROUTER_MODEL     | Keep the existing key if valid; choose a model supporting forced function calls     | One model provider is required for real AI rounds                                      |
| Real AI, intended default provider       | LLM_PROVIDER=gemini, GEMINI_API_KEY                               | Google AI Studio API key with access/quota for the selected models                  | Alternative to OpenRouter; both keys are unnecessary                                   |
| Gemini models                            | GEMINI_MODEL, GEMINI_FAST_MODEL                                   | Defaults are gemini-3.8-flash and gemini-3.5-flash-lite; override only if necessary | Optional                                                                               |
| GitHub enrichment                        | GITHUB_TOKEN                                                      | Token suitable for reading public repositories                                      | Optional, recommended for repeated tests                                               |
| Hosted database                          | DATABASE_URL                                                      | Postgres connection URL including credentials; Neon pooled URL or another Postgres  | Optional in dev; required in production                                                |
| Stable anonymous ownership               | SESSION_SECRET                                                    | A separate random secret, at least 32 characters                                    | Existing setting; production requires it when ownership cookies are used               |
| Account/session signing                  | AUTH_SECRET                                                       | Random secret, at least 32 characters; different from SESSION_SECRET                | Configure whenever testing login                                                       |
| Google login                             | AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET                                | OAuth Web application client ID and secret                                          | Required only to test Google login                                                     |
| Email login and change-request emails    | EMAIL_API_KEY, EMAIL_FROM                                         | Resend-compatible email API key and sender address                                  | Required only for email features                                                       |
| Distributed locks, cache and rate limits | UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN                  | Both values from an Upstash Redis database                                          | Optional in dev; needed for serverless production                                      |
| Durable AI background jobs               | QSTASH_TOKEN, QSTASH_CURRENT_SIGNING_KEY, QSTASH_NEXT_SIGNING_KEY | Token and both signing keys from Upstash QStash                                     | Optional locally; recommended for serverless testing/deployment                        |
| QStash callback host                     | JOBS_BASE_URL                                                     | Public HTTPS base URL of the running app                                            | Optional if request origin is correct; use an explicit URL behind a proxy              |
| Scheduled retention                      | CRON_SECRET                                                       | Random secret, at least 16 characters                                               | Needed to authenticate retention calls; route-method issue below must also be resolved |
| Absolute links/redirects                 | NEXT_PUBLIC_APP_URL                                               | Exact app URL and port; existing value is http://localhost:3500                     | Recommended; keep aligned with the running app                                         |
| Optional auth URL                        | AUTH_URL                                                          | Canonical auth/app origin if explicitly needed                                      | Optional; supported by the schema but absent from .env.example                         |
| Landing page 3D scene                    | NEXT_PUBLIC_SPLINE_SCENE                                          | Public .splinecode scene URL                                                        | Optional; animated fallback exists                                                     |
| Error reporting                          | ERROR_WEBHOOK_URL, ERROR_WEBHOOK_TOKEN                            | Compatible JSON POST endpoint; optional bearer token                                | Optional                                                                               |

Additional controls supported by the code:

- GEMINI_BASE_URL: only for a Gemini proxy/mock. Normally omit.
- EMAIL_API_URL: defaults to https://api.resend.com/emails. Override only for a compatible API.
- QSTASH_URL: for a local QStash development server/custom endpoint; omit for hosted QStash.
- VERCEL_AUTOMATION_BYPASS_SECRET: deployment-protection bypass used by QStash and the smoke script when testing protected Vercel deployments.
- LLM_DAILY_CALL_LIMIT: positive integer; default 2000 logical model calls per UTC day. This is a call counter, not a rupee/dollar spending cap.
- ALLOW_MEMORY_STORE=1: production escape hatch for a single long-running instance. Use shared Redis for serverless deployment.
- ALLOW_FREE_MODELS=1: explicitly permits the OpenRouter provider in production. The current guard applies to this provider as a whole, even if a paid OpenRouter model is selected.
- PGLITE_DIR: optional local development database location; defaults to .pglite.
- SCOPEAI_BASE_URL: base URL for scripts/test-flow.ts; defaults to http://localhost:3000.
- E2E_PORT, E2E_CONTROL_PORT: browser-test ports; defaults 3210 and 3211.
- EVALS_PRICE_IN, EVALS_PRICE_OUT, EVALS_PRICE_CACHE_WRITE, EVALS_PRICE_CACHE_READ: prices per million tokens for evaluation cost reporting. Defaults are zero, so a $0 report alone does not prove a live run was free.
- NODE_ENV, NEXT_RUNTIME, VITEST, CI and npm_package_version are runtime/test controls, not API keys you need to obtain. Let the normal commands set these.

Get credentials/settings from:

- Gemini: https://aistudio.google.com/apikey
- Google OAuth: https://console.cloud.google.com/apis/credentials
- OpenRouter: https://openrouter.ai/settings/keys
- GitHub tokens: https://github.com/settings/tokens
- Postgres/Neon: https://console.neon.tech
- Redis and QStash: https://console.upstash.com
- Email/Resend: https://resend.com/api-keys

Google OAuth setup:

1. Create a Web application OAuth client.
2. Configure the consent screen and add your testers if the OAuth app is in testing mode.
3. For the current local port, add this exact redirect URI:
   http://localhost:3500/api/auth/callback/google
4. For a deployed test site, also add:
   https://YOUR-TEST-HOST/api/auth/callback/google
5. Populate both Google settings and AUTH_SECRET; restart the app.
   Local login can use the PGlite database; a hosted database is not mandatory for a same-machine development run.

Email setup:

- EMAIL_FROM can be quoted as: EMAIL_FROM="Aureon <onboarding@resend.dev>".
- Resend's default test sender is suitable for limited account-owner testing; verify an owned sending domain for broader tester delivery.
- Use a real recipient inbox for magic links. Decision notification delivery also needs email configured and a signed-in project owner.
- SMTP credentials are not used by this implementation.

Generate each app secret separately:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put resulting values in .env.local or the deployment environment. Do not put provider credentials in NEXT*PUBLIC* settings, committed files or screenshots.

## Minimum working local test setup

Your existing OpenRouter settings are sufficient to attempt a real local scoping round, provided the key and quota work. Keep the existing secrets.

Run on the already-configured port:

```powershell
npm run dev -- --port 3500
```

Open http://localhost:3500.

For Gemini testing, change/add these settings while preserving SESSION_SECRET:

```dotenv
LLM_PROVIDER=gemini
GEMINI_API_KEY=YOUR_REAL_GOOGLE_AI_STUDIO_KEY
GEMINI_MODEL=gemini-3.8-flash
GEMINI_FAST_MODEL=gemini-3.5-flash-lite
NEXT_PUBLIC_APP_URL=http://localhost:3500
```

Remove/comment unused optional entries instead of adding KEY= blank lines. Several optional values in lib/env.ts reject empty strings; .optional() accepts absence, not an empty URL or short secret. Blindly copying every empty entry from .env.example can cause validation failures.

No DATABASE_URL in dev starts file-backed PGlite and automatically applies migrations. Redis is optional locally; jobs use Next after(). Postgres stores projects, rounds and shares; Redis is used for shared locks/cache/rate limits. Older comments describing Redis as the primary project/session store are stale.

For an external Postgres test database:

1. Set DATABASE_URL to a dedicated testing database.
2. Run npm run db:migrate.
3. Restart npm run dev.
   Do not run migration commands against an unintended database.

## Account and deployment tests

Anonymous browsers can retain one saved scope. A second scope asks for sign-in. Configure Google or email login for repeated account-based testing, project ownership across devices, and workspace analytics. Use two test accounts and an incognito browser for access checks.

For a shared serverless staging site, provide:

- One provider and its key; Gemini is the code's default intended production choice.
- DATABASE_URL, then apply migrations to that staging database.
- SESSION_SECRET.
- Both Redis REST settings.
- QStash token and both signing keys, plus a reachable HTTPS callback URL.
- NEXT_PUBLIC_APP_URL matching the staging host.
- AUTH_SECRET plus at least one sign-in method to test account features.
- CRON_SECRET if testing the retention schedule.
- Email configuration if notification delivery is in scope.

Hosted QStash cannot call localhost on your computer. Leave it unconfigured for basic local runs, or use a reachable test deployment/tunnel and shared storage. A cloud job callback cannot rely on another process's local PGlite files or in-memory locks.

A successful build is not proof of valid production runtime configuration. The current .env.local failed a separate production environment check for:

1. OpenRouter requires the explicit ALLOW_FREE_MODELS opt-in in production.
2. DATABASE_URL is missing.
3. Shared Redis settings are missing, without a single-instance override.
   Production cookie creation also requires SESSION_SECRET (already present).

## Checks performed in this review

| Check                                            | Actual result                                                  |
| ------------------------------------------------ | -------------------------------------------------------------- |
| Node/npm                                         | Node 24.19.0, npm 11.17.0 available; project asks for Node 22+ |
| npm run typecheck                                | Passed                                                         |
| npm run lint                                     | Passed                                                         |
| npm test                                         | 70 files, 1030 tests passed                                    |
| npm run build                                    | Passed with Next.js 16.3.8                                     |
| npm run evals:mock                               | 30 cases completed, no failed calls; local mock only           |
| Production configuration validation              | Failed on the three configuration requirements above           |
| Playwright Chromium availability                 | Missing; browser suite not run                                 |
| Real AI/GitHub/database/email/OAuth/QStash calls | Not validated                                                  |
| Manual real-device tests                         | Not performed                                                  |

Mock evaluation accuracy numbers are fixture agreement, not a measurement of the real provider. All 30 labels are described as drafts in evals/README.md. Review them before using evaluation scores in an internship report.

## Issues to resolve or verify before sign-off

1. Port consistency: .env.local uses 3500, npm run dev defaults to 3000, and test-flow defaults to 3000. Start on 3500 and set SCOPEAI_BASE_URL for the smoke script, or update all URLs/callbacks together.
2. Blank optional configuration: omit/comment unused optional variables instead of leaving empty assignments.
3. Scheduled retention method mismatch: app/api/cron/retention/route.ts exports POST only; vercel.json schedules it with Vercel cron, which sends GET. The deployed schedule would receive 405 until a matching authenticated GET handler or suitable POST scheduler is supplied. Existing retention tests call POST, so they do not catch this integration issue. No code was changed during this review.
4. Production configuration: current local provider/storage setup cannot be used unchanged for a serverless deployment.
5. Real AI baseline: openrouter/free chooses among available free models, which makes repeatability harder. Use a fixed compatible model/provider for the internship quality baseline. Existing credentials do not establish availability, quota or output quality.
6. Browser prerequisites: install Playwright Chromium before running the browser tests.
7. Production-browser verification: the CSP implementation documents a cached-page nonce limitation; check privacy, terms, unknown URLs, share pages and exports in staging. This was not re-measured here.
8. Import limits: 5 MB upload limit and a 50,000-byte submitted-content budget. Image-only scanned PDFs do not have an OCR integration in this code; include one as a negative test.
9. Retention is not total erasure: the default raw-input retention is 90 days of inactivity. Generated documents and extraction evidence are retained. Verify the behavior intended for your internship test dataset.
10. Health is liveness only: /api/health returning 200 does not prove AI, storage, login or job delivery works.

## Internal and manual test order

1. Repeat the automated baseline when code changes:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run evals:mock
```

2. Install/run the browser suite:

```powershell
npx playwright install chromium
npm run test:e2e
```

The configured suite uses a mock Gemini server and an isolated .pglite-e2e database, resetting that test database on startup. Keep ports 3210/3211 free and avoid running another server against the same test database.

3. Start the real local app on 3500, then run a single live API smoke test from another terminal:

```powershell
$env:SCOPEAI_BASE_URL = 'http://localhost:3500'
npx tsx scripts/test-flow.ts
```

This calls your configured real provider and GitHub; it can consume quota/cost and creates a test project. scripts/test-extract.ts and scripts/test-github.ts are narrower live diagnostics.

4. Prepare these human inputs:

- Two tester accounts/inboxes and an incognito browser.
- At least three briefs: a vague idea, a detailed web project, and a project from a second domain such as education or an internal operations tool.
- For a detailed brief, specify all nine areas: goal, users/roles, features, stack, external integrations, performance/security/accessibility needs, budget/currency, deadline, and measurable acceptance criteria.
- Example detailed scenario: an internal inventory web app for an administrator and warehouse staff; products, stock movements, low-stock alerts and CSV exports; Next.js/Postgres; email notifications; role-based access, backups and 200 concurrent users; INR 2 lakh budget; eight weeks; stock updates reflected within two seconds with an audit trail.
- .txt/.md/.docx/text-based .pdf files containing the same requirements.
- Unsupported file, image-only PDF, file larger than 5 MB, long input and Hindi/Hinglish input.
- Representative expected modules/questions agreed with your mentor, to judge whether the generated scope is useful.
- A small number of completed-project actuals if testing effort recording/calibration. The workspace calibration requires five eligible recorded projects.

5. Record manual outcomes:
   | Test | Expected result |
   | --- | --- |
   | Detailed brief | Useful extraction, justified confidence and relevant modules; no invented confirmed requirements |
   | Vague brief | Clarification/blocker behavior; prevents treating missing core goal/features as ready |
   | Questions and Other answer | Answers persist and affect later scope; empty Other text is rejected |
   | Generate anyway | Clearly labelled lower-confidence draft with unresolved items |
   | Edit and reload | Saved content survives refresh; changes create a version; diff shows the changes |
   | Imports | Editable preview before creation; unsupported/oversized/unreadable files show an error |
   | Exports | Open downloaded Markdown, PDF and DOCX; import CSVs into test Jira/Linear projects if verifying importer compatibility; check formatting and Unicode |
   | Share and approval | Recipient sees the shared version; approve and request-changes decisions persist; revoke/expiry prevents access |
   | Owner isolation | Another account/incognito browser cannot read/edit a private project by copying its ID |
   | Login | Google/email redirects return to the correct host; anonymous scope follows sign-in; second-device history works |
   | Recovery | Invalid key/quota/network failure gives a visible error and appropriate retry; duplicate clicks do not double-run |
   | Queue in staging | Signed QStash callbacks complete jobs; invalid signatures fail; protected deployments remain reachable |
   | Effort/calibration | Actuals require an approved version; eligible history changes estimates and is labelled |
   | Responsive usability | Laptop and physical phone browser; input, questions, editing, dialogs and exports usable |
   | Retention | Authenticate the scheduler and verify intended raw-input clearing in a disposable staging dataset |

For real phone access during local dev, use the laptop's LAN IP and matching host/port with both devices on the same network; login and shared-link testing is simpler on an HTTPS staging URL. localhost on the phone refers to the phone itself.

6. Review labels and establish a real AI quality baseline:

```powershell
npx tsx evals/run.ts --dry-run
npx tsx evals/run.ts --runs=1 --cases=thin,saas
```

Expand to the full dataset only after the smaller run works. Set real price overrides if the provider is billed. Retain per-case outputs, durations, errors, expected/actual results, and screenshots of failures for your internship evidence.

## Primary documentation checked

- Google key setup: https://ai.google.dev/gemini-api/docs/api-key
- Gemini supported models and Interactions API: https://ai.google.dev/gemini-api/docs/interactions-overview
- OpenRouter free router behavior: https://openrouter.ai/openrouter/free/apps
- GitHub REST rate limits: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- Vercel cron HTTP method: https://vercel.com/docs/cron-jobs
- Bundled Next.js environment guide: node_modules/next/dist/docs/01-app/02-guides/environment-variables.md

The existing PROJECT_AUDIT.md contains historical findings referencing Anthropic and older implementations. This checklist uses the current source instead. No application code or secret settings were modified.
