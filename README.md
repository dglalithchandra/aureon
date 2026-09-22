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
- 🔎 **Hybrid Retrieval** — Vector Search + BM25 + Reciprocal Rank Fusion
- 🎯 **Smart Questioning** — asks targeted questions instead of generic follow-ups
- 📊 **Scope Confidence** — measures how complete the project definition is
- 🧩 **Domain-Aware Analysis** — adapts requirements to the project domain
- 👤 **Client View** — simple, non-technical project scope
- 👨‍💻 **Engineer View** — technical modules, constraints and effort indicators
- ⚠️ **Missing Items Panel** — clearly shows unresolved requirements
- 🔄 **Scope Diff** — shows what changed after clarification rounds

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
(Vector + BM25 + RRF)
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

## 🧪 Testing

Tests use [Vitest](https://vitest.dev) and never call a paid API or GitHub.

```bash
npm test                    # run everything once
npm run test:watch          # re-run on change
npm test -- --coverage      # with a coverage report (coverage/)
```

- `tests/unit/` — pure logic: exit rules, question filtering, GitHub signal
  merge, output coercion, query building, BM25, cookies, markdown export.
- `tests/integration/` — the full create → round → answers → final output
  pipeline against `tests/mocks/mock-anthropic.ts`, a local stand-in for the
  Anthropic Messages API (selected through `ANTHROPIC_BASE_URL`).
- `tests/setup.ts` replaces every credential with a dummy value and blocks all
  non-local network requests, so a missing mock fails instead of spending money.

CI (`.github/workflows/ci.yml`) runs typecheck, lint, format check, tests with
coverage, build and `npm run audit` on every push and pull request.

The scripts in `scripts/` are manual smoke tests against **real** services:
`test-flow.ts` drives a running server end to end (create → run → answer →
finalize), while `test-extract.ts` and `test-github.ts` call Anthropic and
GitHub directly. They are not part of `npm test`.

`test-flow.ts` also times every API response (each must take under 2 s) and
every round (p95 must be under 45 s). To measure a Vercel preview over 10 runs:

```bash
SCOPEAI_BASE_URL=https://<preview-url> npx tsx scripts/test-flow.ts --runs=10
```
