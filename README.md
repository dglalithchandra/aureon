# Aureon

### From vague ideas to build-ready scope.

> **Know what you know. Expose what you don't. Ask what matters.**

Aureon is an intelligent project-scoping system that transforms
incomplete client ideas into structured, measurable and build-ready
requirements before development begins.

---

## 🚀 What is Aureon?

Most project failures don't begin with bad code.

They begin with an unclear idea.

Aureon helps turn an incomplete idea into a clear project scope by
identifying what is already known, what is missing, and what needs to be
clarified before development starts.

---

## ✨ Key Features

- 🧠 **Requirement Intelligence** — identifies PRESENT, PARTIAL and MISSING requirements
- 🔎 **Hybrid Retrieval** — several GitHub queries per round, merged with
  Reciprocal Rank Fusion and re-ranked with BM25 over the results' text.
  There is no vector index and no embedding model.
- 🎯 **Smart Questioning** — asks targeted questions instead of generic follow-ups
- 📊 **Scope Confidence** — a score the server computes from the parameter
  states (coverage, the AI's clarity read, how far those two agree, and a
  small GitHub bonus), capped while the goal, features, users or tech
  constraints are missing. The AI never grades its own answer.
- 🧩 **Domain-Aware Analysis** — adapts requirements to the project domain
- 👤 **Client View** — simple, non-technical project scope
- 👨‍💻 **Engineer View** — technical modules, constraints and effort indicators
- ⚠️ **Missing Items Panel** — clearly shows unresolved requirements
- 🔄 **Scope Diff** — every generation and every saved edit is an immutable
  version; any two can be compared at `/projects/[id]/versions`

---

## 🏁 Getting started

Node 20.9 or newer (the CI matrix runs 20, 22 and 24) and npm.

```bash
git clone <this repo> && cd scopeai
npm install
cp .env.example .env.local
npm run dev                    # http://localhost:3000
```

`npm run dev` works with an **empty** `.env.local`, with two limits: no
database means the app starts a file-backed Postgres in `.pglite/`, and no
model key means every round fails at the first call. For a working local
setup, one key is enough:

```bash
# .env.local
GEMINI_API_KEY=...             # free, no card: https://aistudio.google.com/apikey
```

Everything else is optional in development and has a documented fallback:
without `DATABASE_URL` the app uses PGlite, without Upstash it rate-limits in
memory, without `QSTASH_TOKEN` jobs run in-process after the response, without
`GITHUB_TOKEN` the GitHub search is anonymous (60 requests an hour), and
without `AUTH_SECRET` plus a sign-in method the app is anonymous-only (one
scope per browser). `.env.example` documents every variable, where to get it
and what happens when it is missing.

| Command                                 | What it does                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `npm run dev`                           | Development server                                                            |
| `npm run build` / `npm start`           | Production build and server                                                   |
| `npm test`                              | Unit and integration tests (no network, no spend)                             |
| `npm run test:e2e`                      | Browser tests (Playwright; first run needs `npx playwright install chromium`) |
| `npm run typecheck` / `lint` / `format` | Strict TypeScript, ESLint, Prettier                                           |
| `npm run db:migrate`                    | Apply the SQL migrations in `drizzle/`                                        |
| `npm run evals:mock`                    | The evaluation harness against the mock model                                 |
| `npm run audit`                         | `npm audit` over production dependencies, high and above                      |

**In production** four things are required and the server refuses to start
without them: `DATABASE_URL`, `SESSION_SECRET`, the model key for the chosen
provider, and Upstash (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`)
unless `ALLOW_MEMORY_STORE=1` says this is a single long-running instance.
QStash is strongly recommended: without it a job dies with the function
instance that started it.

---

## ✅ What is built, and what is not

| Area                                                                  | State | Notes                                                                              |
| --------------------------------------------------------------------- | :---: | ---------------------------------------------------------------------------------- |
| Requirement extraction, P-01…P-09 states, evidence and gaps           |  ✅   | One model call per round, validated by Zod                                         |
| Deterministic confidence score, caps and exit rules                   |  ✅   | Computed on the server from the parameter states; the model never grades itself    |
| Clarification rounds (MCQ, blocker questions, added description)      |  ✅   | Up to 3 clarification rounds, then it stops asking                                 |
| GitHub retrieval: multi-query search, RRF, BM25, README module mining |  ✅   | Anonymous or with a token; no vector index                                         |
| Per-module confidence and candidate modules                           |  ✅   |                                                                                    |
| Risk and effort engines (points, velocity, sprints, bands)            |  ✅   | Deterministic; the model only writes the wording                                   |
| Client and engineer documents, fully editable                         |  ✅   | Every section also copies as Markdown                                              |
| Exports: Markdown, PDF, Word, Jira CSV, Linear CSV                    |  ✅   | Word carries the workspace branding, version and approval state                    |
| Requirements import from .txt, .md, .pdf and .docx                    |  ✅   | Read on the server, shown for correction, never stored                             |
| Accounts, workspaces, projects list, retention                        |  ✅   | Needs `DATABASE_URL`; Auth.js with Google and magic links                          |
| Share links, approval gate, version history and scope diff            |  ✅   |                                                                                    |
| Background jobs, SSE progress, per-session locks, rate limits         |  ✅   | QStash in production, `after()` locally                                            |
| Evaluation harness over 30 labelled briefs                            |  🟡   | The harness runs; the labels are drafts and no real report exists yet              |
| Accessibility                                                         |  🟡   | Keyboard and screen-reader basics are in place; no full audit yet                  |
| Vector search / embeddings                                            |  ⬜   | Not built. The retrieval is lexical                                                |
| Two-way Jira, Linear or Notion integration                            |  ⬜   | Not built. The CSV exports are one-way: they create issues, and nothing syncs back |
| Team collaboration in one document (live cursors, comments)           |  ⬜   | Not built. Sharing is a link, and approval is a decision on a version              |
| Self-serve billing                                                    |  ⬜   | Not built                                                                          |

---

## 🏗️ How It Works

```text
User Idea
   ↓
Context Pre-Check
   ↓
Domain Detection
   ↓
Requirement Extraction
   ↓
Hybrid Retrieval
(multi-query GitHub + RRF + BM25)
   ↓
Parameter State Analysis
(PRESENT / PARTIAL / MISSING)
   ↓
Scope Confidence
   ↓
Smart Clarification
   ↓
Build-Ready Scope
   ↓
Client View + Engineer View
```

### Background jobs

No HTTP request waits for an LLM. `POST /api/session/[id]/run`, `/answer` and
`POST /api/finalize` validate the request, take the session's lock and answer
**202** with the session. The work runs as a job:

- **Production:** [Upstash QStash](https://upstash.com/docs/qstash) delivers
  each job to `POST /api/jobs/[type]`, which only runs requests carrying a valid
  QStash signature. Finalize queues the client and engineer views as two jobs,
  and the output page shows each one as soon as it lands.
- **Local dev (no `QSTASH_TOKEN`):** jobs run in the same process after the
  response (`after()` from `next/server`). This is fine locally but not durable.

The browser follows progress over Server-Sent Events
(`GET /api/session/[id]/events`) and falls back to polling if the stream drops.

To set up QStash, create a QStash project at
[console.upstash.com/qstash](https://console.upstash.com/qstash) and copy
`QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` into
the Vercel project's environment variables. For preview deployments behind
Vercel Deployment Protection, enable **Protection Bypass for Automation**. The
app forwards the resulting secret to QStash so its calls get through.

---

## 🗄️ Accounts and storage

Projects, share links and accounts live in Postgres (Drizzle). Redis keeps
only what may vanish: locks, rate limits, caches and live job progress.

```bash
cp .env.example .env.local     # then fill DATABASE_URL
npm run db:migrate             # create the tables
npm run dev
```

Without `DATABASE_URL`, development starts on a local file-backed Postgres
(PGlite in `.pglite/`) so the app runs before any database exists. Production
refuses to start without a real one.

Sign-in is [Auth.js](https://authjs.dev) with a magic link and Google, and it
is optional: with neither configured the app works anonymously, one scope per
browser. Signing in claims every scope that browser made. A daily cron
(`/api/cron/retention`) blanks raw client input after the workspace's
retention period — 90 days of no activity by default — and keeps the
documents.

## 🔐 Privacy

A brief is often confidential and sometimes contains personal data, so what
happens to it is written down rather than implied: [`/privacy`](app/privacy)
lists what is stored, every processor that sees it (Gemini, Vercel, Postgres,
Upstash, GitHub, the email API), how long it stays and how to delete it, and
[`/terms`](app/terms) says what a generated scope is and is not. The chat input
says the same thing in one line where the pasting happens. Raw input is deleted
after 90 days of inactivity; the documents are kept. A delete is a hard delete
and takes the share links with it. Production refuses to run on OpenRouter's
free models — they route to third parties — unless `ALLOW_FREE_MODELS=1`.

## 🧪 Testing

Tests use [Vitest](https://vitest.dev) and never call a paid API or GitHub.

```bash
npm test                    # run everything once
npm run test:watch          # re-run on change
npm test -- --coverage      # with a coverage report (coverage/)
npm run test:e2e            # the browser tests (Playwright)
```

- `tests/unit/` — pure logic: exit rules, question filtering, GitHub signal
  merge, output coercion, query building, BM25, cookies, markdown export.
- `tests/integration/` — the full create → round → answers → final output
  pipeline against `tests/mocks/mock-llm.ts`, a local stand-in for the Gemini
  Interactions API (selected through `GEMINI_BASE_URL`).
- `tests/e2e/` — the browser tests (Playwright, Chromium). They drive the real
  app: edit every section of both views and reload, answer an open item and
  check the new version, generate a scope before the questions are finished
  and check the "Low confidence draft" banner, and exercise the
  unsaved-changes guard, the 10-second local autosave and the rename.
  `scripts/e2e-server.ts` starts `next dev` against the mock model and a
  throwaway PGlite database in `.pglite-e2e/`, so a run needs no credentials
  and spends nothing. First run: `npx playwright install chromium`. They are
  not part of `npm test`.
- `tests/setup.ts` replaces every credential with a dummy value and blocks all
  non-local network requests, so a missing mock fails instead of spending money.

CI (`.github/workflows/ci.yml`) runs typecheck, lint, format check, tests with
coverage, build and `npm run audit` on every push and pull request.

The scripts in `scripts/` are manual smoke tests against **real** services:
`test-flow.ts` drives a running server end to end (create → run → answer →
finalize), while `test-extract.ts` and `test-github.ts` call Gemini and
GitHub directly. They are not part of `npm test`.

`test-flow.ts` also times every API response (each must take under 2 s) and
every round (p95 must be under 45 s). To measure a Vercel preview over 10 runs:

```bash
SCOPEAI_BASE_URL=https://<preview-url> npx tsx scripts/test-flow.ts --runs=10
```

## 📏 Evaluation

The extraction is measured against 30 labelled briefs in [`evals/cases/`](evals/cases):
five thin one-liners, three that block, three over 20,000 characters, three in
Hinglish or Hindi, two prompt-injection attempts, and rich briefs across the
nine domains. Each case carries the expected state of P-01…P-09, the expected
domain, the modules a usable scope must contain, and a note explaining the
judgement calls.

```bash
npm run evals:mock          # the harness against the mock server: no spend, runs in CI
npm run evals               # 30 cases x 3 runs against the REAL provider (costs money)
npx tsx evals/run.ts --dry-run          # print the plan and the cost estimate only
npx tsx evals/run.ts --runs=1 --cases=thin,blocker
```

A run writes `evals/reports/<date>.md` and `.json` with per-parameter exact and
within-one-level accuracy, domain accuracy, module recall, the score's standard
deviation across identical runs, ready/ask agreement, tokens and estimated
cost, and latency p50/p95. Targets live in [`evals/targets.json`](evals/targets.json).

<!-- evals:latest -->

No real report yet. `npm run evals` writes one and updates this line; the mock
run in CI proves the harness works but says nothing about quality.

<!-- /evals:latest -->

**The labels are drafts.** They are one person's reading of each brief, and
several are genuinely arguable (each case says which). Until they are reviewed
and the case files say `"label_status": "reviewed"`, the accuracy numbers
measure agreement with a guess.
