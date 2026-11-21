# Aureon

Aureon is an AI-assisted requirements engineering and project-scoping application. It takes an incomplete client brief, identifies what is known and missing, retrieves relevant public GitHub references, asks focused clarification questions, and produces separate client and engineering documents.

[Live application](https://aureon-gp1k.vercel.app) · [Demo video](https://youtu.be/rT2Ah1Cq8zs) · [Project report](PROJECT_REPORT.md)

## Why we built it

Software projects often begin with notes, messages, or meeting summaries that mix confirmed requirements with assumptions. Starting implementation from that material creates avoidable rework. Aureon gives the team a reviewable scope before development begins and keeps unresolved decisions visible.

The language model handles interpretation and drafting. Application code remains responsible for validation, confidence scoring, blocker rules, risk and effort calculations, access control, rate limits, persistence, versioning, and recovery.

## Workflow

1. Paste a brief or import a TXT, Markdown, PDF, or DOCX file.
2. Extract nine requirement areas into validated structured data.
3. Search public GitHub repositories and inspect the strongest references.
4. Calculate confidence and decide whether clarification is needed.
5. Ask only questions that change the scope.
6. Generate editable client and engineering views.
7. Export, share, approve, compare versions, and record actual effort.

## Main capabilities

- Structured requirement extraction with evidence and gaps
- Deterministic confidence, blocker, risk, and effort calculations
- GitHub retrieval using multiple queries, reciprocal-rank fusion, BM25, README analysis, and folder evidence
- Separate client and engineering documents generated from one validated scope
- Background processing with progress events, locking, retries, and recovery
- Project storage, immutable versions, comparison, sharing, and approval
- Markdown, PDF, Word, Jira CSV, and Linear CSV exports
- Optional accounts and workspaces, with anonymous access for evaluation
- Calibration from completed-project estimates and actual effort

## Architecture

```text
Browser
  Next.js pages, React components, editing and progress UI
      |
Application API
  Route handlers, Zod validation, ownership and rate limits
      |
Background processing
  QStash in production, Next.js after() during local development
      |
Intelligence pipeline
  extraction -> GitHub retrieval -> scoring -> clarification -> output
      |
Data and operations
  Neon Postgres, Upstash Redis, Vercel and error webhooks
```

Postgres stores projects, rounds, versions, approvals, shares, and calibration records. Redis stores data that can expire safely, including locks, rate-limit counters, caches, budgets, and live progress.

## Local setup

Requirements:

- Node.js 22 or newer
- npm
- One supported model-provider key for live AI calls

```powershell
git clone https://github.com/dglalithchandra/aureon.git
cd aureon
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open `http://localhost:3000/chat`.

The application uses PGlite when `DATABASE_URL` is absent, in-memory operational controls when Upstash is absent, and local `after()` jobs when QStash is absent. Live model calls still require a valid provider key.

### Minimum environment variables

```dotenv
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=replace_with_your_key
OPENROUTER_MODEL=nvidia/nemotron-3.5-super-vl:free
```

For production, configure a real `DATABASE_URL`, `SESSION_SECRET`, model-provider credentials, Upstash Redis, and preferably QStash. Review [.env.example](.env.example) for the complete list and fallback behavior. Never commit `.env.local` or API keys.

## Useful commands

| Command              | Purpose                                                       |
| -------------------- | ------------------------------------------------------------- |
| `npm run dev`        | Start the development server                                  |
| `npm run build`      | Create a production build                                     |
| `npm run typecheck`  | Run TypeScript checks                                         |
| `npm run lint`       | Run ESLint                                                    |
| `npm test`           | Run unit and integration tests without external network calls |
| `npm run test:e2e`   | Run Playwright browser tests                                  |
| `npm run evals:mock` | Run the evaluation harness with the mock model                |
| `npm run db:migrate` | Apply database migrations                                     |
| `npm run audit`      | Check production dependencies for high-severity advisories    |

The current automated baseline is 77 test files and 1,086 passing tests. Tests replace credentials with dummy values and block non-local network requests.

## Repository guide

- `app/` contains pages and API routes.
- `components/` contains the chat, output, project, and shared interface components.
- `lib/pipeline/` contains extraction, enrichment, scoring, clarification, and finalization orchestration.
- `lib/llm/` contains provider routing and structured-output handling.
- `lib/github/` contains repository search, ranking, and README module extraction.
- `lib/scoring/` contains deterministic confidence, risk, module, and effort logic.
- `lib/storage/`, `lib/db/`, and `drizzle/` contain persistence and migrations.
- `tests/` contains unit, integration, and browser coverage.
- `evals/` contains the labelled evaluation harness.
- `docs/` contains the threat model and production runbook.

## Current limitations

- Free model endpoints can be slow or temporarily unavailable.
- GitHub ranking is lexical and does not use embeddings or a vector database.
- Image-only PDFs require OCR, which is not included.
- Jira and Linear exports are one-way CSV files rather than live integrations.
- Sharing supports review and approval, but not simultaneous editing or comments.
- Evaluation labels are still drafts and need an independent review before accuracy claims are made.

## Development note

AI development tools were used for code review suggestions, debugging, refactoring, test support, and documentation checks. We reviewed the changes and retained responsibility for the requirements, architecture, implementation decisions, testing, and final submission.

## Licence

This repository is an internship project. No open-source licence has been assigned, so reuse requires permission from the authors.
