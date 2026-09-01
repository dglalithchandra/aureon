# ScopeAI

> Turn raw client requirements into engineer-ready scope.

Paste an unstructured requirement document (messages, call notes, rough text)
and ScopeAI returns two synchronized views:

- **Client view** — plain English, modules, milestones, assumptions, open items.
- **Engineer view** — module table with concrete tech stacks, REST endpoints,
  database sketch, RBAC matrix, sprint plan, per-module security checklist,
  risks, and GitHub references for similar real-world projects.

The pipeline runs an AI scoping interview (max 3 clarification rounds, MCQ-only
questions), validates inferred modules against the top similar open-source
projects on GitHub, and produces a structured, editable, exportable scope
document.

## Architecture

The full design — pipeline rationale, confidence formula, gating rules,
domain templates — is documented in
[`scopeai_master_blueprint.html`](./scopeai_master_blueprint.html). Open it
locally in a browser.

### Stack

- **Framework**: Next.js 16 App Router · TypeScript strict · Turbopack
- **Theme**: Tailwind v4 + custom blueprint design system
- **LLM**: Claude Sonnet 4.6 + Haiku 4.5 via `@anthropic-ai/sdk` (server-only,
  prompt caching enabled)
- **GitHub intelligence**: `@octokit/rest` with graceful 403/429 fallback
- **Storage**: Upstash Redis (in-memory dev fallback) for rate limiting,
  session state (24h TTL), GitHub cache (24h TTL), share tokens (30d TTL)
- **Animations**: Framer Motion (transitions, tilts) + GSAP ScrollTrigger
  (pinned timeline, code-split) + Spline (3D hero, intersection-observer-gated)
- **Validation**: Zod schemas at every API boundary
- **Security**: HMAC-signed session cookies, deep DOMPurify sanitize,
  per-route rate limiting, CSP headers, content-type enforcement

### Routes

```
/                      Marketing landing
/chat                  Scoping interview (real-time pipeline + MCQ)
/output/[sessionId]    Editable two-stage output viewer
/share/[token]         Public read-only output (cached 5min, no edit controls)

/api/health            Liveness probe
/api/extract           Extraction LLM call (60s)
/api/github            GitHub enrichment + LLM module mapping (30s)
/api/session           Create + run round 0 (60s)
/api/session/[id]      GET (auth), PATCH (edit final_output)
/api/session/[id]/answer  Submit MCQ answers, advance round (60s)
/api/finalize          Generate two-stage output (60s)
/api/share             Mint share token
```

## Getting started

### 1. Install

```bash
npm install
```

### 2. Configure environment

Copy the template and fill in keys:

```bash
cp .env.example .env.local
```

Required:

- `ANTHROPIC_API_KEY` — get from <https://console.anthropic.com/>
- `SESSION_SECRET` — 32+ char string used to HMAC-sign session cookies
  (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)

Optional:

- `GITHUB_TOKEN` — raises GitHub rate limit from 60/hr to 5000/hr
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — required for
  multi-instance production. Local dev uses an in-memory fallback.
- `NEXT_PUBLIC_SPLINE_SCENE` — Spline scene URL for the 3D hero. Without it,
  the hero renders an animated SVG wireframe.
- `NEXT_PUBLIC_APP_URL` — production URL used for absolute share links.

### 3. Run

```bash
npm run dev          # http://localhost:3000
npm run typecheck
npm run lint
npm run build && npm start
```

### 4. Smoke-test the full pipeline

Requires `ANTHROPIC_API_KEY` in `.env.local` and the dev server running.

```bash
npx tsx scripts/test-extract.ts        # one extraction call
npx tsx scripts/test-github.ts         # GitHub search + enrichment
npx tsx scripts/test-session-units.ts  # cookie sign/verify, byte counters
npx tsx scripts/test-markdown.ts       # markdown exporter unit checks
npx tsx scripts/test-flow.ts           # full session: extract → answer → finalize
```

## Deployment

ScopeAI deploys cleanly to Vercel.

1. Connect the repo. Vercel detects Next.js automatically.
2. In **Project → Settings → Environment Variables (Production)** set:
   - `ANTHROPIC_API_KEY` (encrypted)
   - `SESSION_SECRET` (encrypted)
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN` (encrypted)
   - `GITHUB_TOKEN` (encrypted, optional)
   - `NEXT_PUBLIC_APP_URL=https://<your-domain>`
   - `NEXT_PUBLIC_SPLINE_SCENE` (optional)
3. [`vercel.json`](./vercel.json) sets per-route function timeouts (60s for
   LLM-bound routes, 30s for GitHub).
4. Ship.

### Post-deploy smoke

```bash
curl https://<domain>/api/health
# → {"ok":true,"version":"0.1.0"}

curl -I https://<domain>/ | grep -i content-security-policy
# → Content-Security-Policy: default-src 'self'; ...
```

## Security

- **CSP** + HSTS + X-Frame-Options + Referrer-Policy + Permissions-Policy
  applied to every route.
- **Rate limiting** at the proxy layer (10 req/min/IP) and per-route for
  expensive endpoints.
- **Session cookies** are HttpOnly, SameSite=Lax, Secure-in-prod, signed with
  HMAC-SHA256 (constant-time verification).
- **Share tokens** are 32-byte URL-safe random strings with 30-day TTL.
- **Input** capped at 50KB (raw + answers combined). LLM output bounded by
  Zod string-length limits and DOMPurify sanitize before storage.
- **No HTML rendering** of LLM or user content — everything goes through
  `react-markdown` with an explicit allow-list, never `dangerouslySetInnerHTML`.

## Project layout

```
app/                   App Router routes (page.tsx, route.ts)
components/
  landing/             Hero, HowItWorks, OutputCards, TechStack, CTA
  chat/                ChatLayout, MessageList, MCQCard, PipelinePanel, ...
  output/              ClientView, EngineerView, ModuleCard, ExportMenu, ...
lib/
  llm/                 Anthropic client + prompt builders
  github/              Octokit client + search + module extraction
  pipeline/            extract, github-enrich, mcq, orchestrator, finalize, merge
  schemas/             Zod schemas (extraction, github, mcq, output)
  security/            sanitize, deep-sanitize, rate-limit, session-cookie, route-helpers
  storage/             session, share, cache (Upstash + in-memory fallback)
  export/              markdown
scripts/               Smoke tests and the e2e flow runner
public/                robots.txt
```

## License

Proprietary — internal project.
