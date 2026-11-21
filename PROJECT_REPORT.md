# Aureon Internship Project Report

## Project information

**Project title:** Aureon

**Project type:** AI-assisted requirements engineering and project scoping platform

**Team:** D Lalith Chandra and Satvika Prashanth Hiremath

**Institution:** BMS Institute of Technology and Management

**Class:** AIML-1, Semester 5

**Submission date:** 21 November 2026

**Live application:** https://aureon-gp1k.vercel.app

**Source code:** https://github.com/dglalithchandra/aureon

**Demonstration video:** https://youtu.be/rT2Ah1Cq8zs

## Declaration about the development record

This report describes the system we designed, implemented, tested, and deployed as our internship project. The seven-month account records the sequence in which the work developed: problem study, prototype, structured extraction, evidence retrieval, persistence, reliability, and deployment. The public Git history begins in September 2026 and therefore does not prove seven separate calendar months. We have treated the seven months as development phases and have not invented commit dates for work that was not committed at the time.

AI coding tools were used for code review suggestions, debugging support, refactoring, test ideas, and documentation checks. We reviewed those suggestions and remained responsible for the product requirements, architecture, implementation decisions, validation rules, test acceptance, deployment, and final submission. The language models used inside Aureon are part of the product itself and are separate from the tools used while writing code.

## Abstract

Aureon is a web application that turns an incomplete client brief into a structured and reviewable software scope. A user can paste text or import a TXT, Markdown, PDF, or DOCX document. The application extracts nine requirement areas, marks each area as present, partially described, or missing, and stores the evidence behind that decision. It then searches public GitHub repositories for implementation references, scores the completeness of the scope using deterministic server-side rules, and asks clarification questions when a missing decision could change the proposed product. When the scope is ready, Aureon creates two documents from the same validated state: a client view written in plain language and an engineering view containing modules, architecture, integrations, risks, effort, tests, and repository references.

The system is more than a user interface around one prompt. It includes structured model calls, schema validation, bounded repair, multi-key provider routing, public-code retrieval, deterministic confidence and effort calculations, background jobs, durable storage, version history, sharing, approval, exports, rate limits, audit records, retention, and recovery. We designed these surrounding controls because model output can be slow, inconsistent, truncated, or unavailable. The application saves progress before long work begins and keeps important decisions in code rather than asking the model to grade itself.

The final application is built with Next.js 16, React 19, TypeScript, Zod, Drizzle ORM, Postgres, Redis, QStash, GitHub APIs, and OpenRouter-compatible model providers. It runs locally with development fallbacks and is deployed on Vercel with Neon Postgres and Upstash services. At the time of submission, 77 automated test files containing 1,086 tests passed together with linting, TypeScript checks, formatting, and a production build.

## Contents

1. Project background and problem
2. Objectives, users, and scope
3. Requirement model
4. Overall architecture
5. Complete processing workflow
6. Language model integration and routing
7. GitHub evidence retrieval
8. Confidence, module, risk, and effort calculations
9. Data model and project lifecycle
10. User interface and output experience
11. API, jobs, and live progress
12. Security, privacy, and reliability
13. Testing and evaluation
14. Deployment and operations
15. Seven-month development record
16. Engineering decisions and challenges
17. Current limitations and future work
18. Reproduction and submission evidence

## Project background

### The problem we observed

Software projects rarely begin with a complete specification. A client may send a message such as “build an inventory dashboard,” share meeting notes, or list a few screens. That input may name the visible features but omit user roles, permissions, data retention, integrations, performance expectations, budget, delivery date, and acceptance criteria. An engineer still has to estimate and start planning, so the missing information is silently replaced by assumptions.

These assumptions create two related problems. First, the client and engineering team may believe they agreed on the same product when their mental models are different. Second, an estimate can look precise even though the requirements behind it are uncertain. The disagreement usually appears after implementation begins, when changing database structure, permissions, integrations, or workflows is expensive.

The common alternative is a long discovery form. A fixed form collects data, but it often asks irrelevant questions and does not understand what the user already explained. A general chatbot can respond more naturally, but a free-form response does not provide a stable data model, a repeatable confidence score, or a reliable link between the original brief and the final engineering plan.

### Our proposed solution

Aureon places a controlled discovery stage between a raw client brief and implementation. It reads the brief into a fixed requirement model, shows which claims are supported by the source, asks only the questions that can materially change the scope, and produces two coordinated documents. The client sees outcomes and decisions without unnecessary engineering detail. The development team sees the modules, technical design, dependencies, risk areas, tests, and estimate assumptions.

The product combines model interpretation with deterministic application rules. The model is used where language understanding is useful: extracting meaning, drafting questions, analysing repository descriptions, and writing documents. Code is used where repeatability matters: validation, confidence, caps, module scores, risk rules, effort calculation, authorization, rate limiting, storage, and recovery.

## Objectives

- Accept realistic, unstructured project descriptions instead of requiring a complete form.
- Convert the description into the same nine requirement areas on every run.
- Preserve evidence and gaps so the user can understand each classification.
- Distinguish confirmed requirements from weak assumptions and missing decisions.
- Ask a limited number of targeted clarification questions.
- Retrieve real public repositories without allowing repository text to control the model.
- Calculate confidence and estimates using auditable rules.
- Produce separate client and engineering documents from one project state.
- Preserve edits, versions, approvals, and scope changes.
- Remain usable when an individual model call or background job fails.
- Protect credentials, raw client input, and shared documents.
- Provide enough tests and operational evidence for internal evaluation.

## Intended users

### Primary users

The first user is a business analyst, student team, consultant, or engineer receiving an early project brief. This person needs to discover missing decisions and prepare a scope before development begins.

The second user is the client or project sponsor. This person needs a readable account of the proposed solution, what is included, what is excluded, and what still requires a decision.

The third user is the engineering team. Developers need a more detailed view containing modules, integrations, data considerations, risks, tests, effort, and relevant implementation references.

### Review users

A signed-in workspace can contain owners, editors, and viewers. A reviewer can also receive a version-specific share link. Depending on the link mode, the reviewer can read a document or record an approval decision without receiving access to the whole workspace.

## Implemented scope

The current version supports:

- Text entry and file import for TXT, Markdown, PDF, and DOCX.
- Structured extraction with evidence and gaps.
- Domain and module identification.
- Public GitHub search and repository enrichment.
- Deterministic scope confidence and per-module confidence.
- Blocker detection and clarification questions.
- Multiple clarification rounds with exit rules.
- Separate client and engineering document generation.
- Editable documents, local drafts, and unsaved-change protection.
- Version history and scope comparison.
- Approval and change-request decisions.
- Revocable and expiring share links.
- Markdown, PDF, DOCX, Jira CSV, and Linear CSV exports.
- Actual effort recording and estimate calibration.
- Authentication and anonymous evaluation access.
- Background jobs, live events, polling fallback, rate limits, and daily model budgets.
- Raw-input retention and audit records.

The internship version does not include OCR for scanned files, semantic vector search, simultaneous co-editing, billing, or two-way Jira and Linear synchronization.

## Functional requirements

### Brief intake

The user can paste requirements or attach a supported document. File text is extracted on the server and returned to the browser for review. Aureon does not immediately create a project from an uploaded file because the user should see and correct the extracted content before model processing begins.

### Scope analysis

The system creates a project session, stores the original input, and starts an extraction job. The result includes the domain, nine parameter states, evidence, gaps, candidate modules, a model clarity read, and blocker information. Every result must satisfy the application schema.

### Evidence retrieval

Aureon builds GitHub queries from the detected domain, features, modules, and technology hints. It combines several searches, ranks candidates, reads a small number of strong README files, and records repository and folder evidence. Final documents only receive repository facts returned by the GitHub integration.

### Clarification

If the brief is below the exit threshold, Aureon generates focused questions with an “other” path for free text. Answers are merged with the original description and analysed again. If the project goal or core functionality remains missing, the system can ask the user to rewrite the description instead of repeating weak questions.

### Final documents and project management

Client and engineering views are produced as separate jobs. Each completed half is saved, so a retry regenerates only the missing half. Projects can then be renamed, duplicated, deleted, shared, approved, exported, and compared across versions.

## Non-functional requirements

- **Reliability:** Save state before model work and retain successful partial output.
- **Security:** Keep secrets server-side, validate input, enforce ownership, and verify queue signatures.
- **Explainability:** Show evidence, gaps, score components, caps, risks, and estimate bands.
- **Performance:** Return before long model work finishes and stream progress separately.
- **Maintainability:** Separate schemas, prompts, scoring, storage, jobs, routes, and interface components.
- **Testability:** Keep important calculations as pure functions and mock external services.
- **Cost control:** Cache enrichment, limit deep analysis, route task tiers, and enforce daily budgets.
- **Privacy:** Retain generated output separately from raw client input.

## Requirement model

Aureon evaluates the same nine parameters in every extraction.

| ID and parameter           | Importance | What the system looks for                                               |
| -------------------------- | ---------- | ----------------------------------------------------------------------- |
| P-01 Project goal          | Blocker    | Problem being solved and desired outcome                                |
| P-02 Target users          | High       | User groups, roles, permissions, and context                            |
| P-03 Core features         | Blocker    | Required workflows and behavior                                         |
| P-04 Technical constraints | High       | Platforms, required stack, and existing systems                         |
| P-05 Integrations          | Medium     | Payments, messaging, maps, CRM, and identity services                   |
| P-06 Non-functional needs  | Medium     | Performance, security, compliance, accessibility, uptime, and retention |
| P-07 Budget                | Medium     | Budget range or delivery constraint                                     |
| P-08 Timeline              | Medium     | MVP date, rollout stages, and deadlines                                 |
| P-09 Success criteria      | Low        | Measurable acceptance conditions and business outcomes                  |

Each parameter can be `PRESENT`, `PARTIAL_DEEP`, `PARTIAL_THIN`, or `MISSING`. A timeline such as “launch soon” is not absent, but it is too weak for planning. The partial states record that difference.

Each parameter also stores evidence and a gap. Evidence summarizes what the user provided. The gap explains what remains unknown. This prevents fluent wording from hiding uncertainty.

## System architecture

### Architectural style

Aureon is a full-stack modular monolith. The browser, API routes, background workers, scoring modules, storage adapters, and exports live in one Next.js repository, while external infrastructure provides the database, queue, cache, GitHub access, and model inference.

This structure kept deployment and local setup manageable without placing unrelated responsibilities in one file. Internal boundaries allow model jobs or retrieval to move into a separate service later if measured load requires it.

### High-level flow

1. The browser sends a validated brief to a session API.
2. The API identifies the viewer, applies limits, stores the session, acquires a lock, and queues a round.
3. The job runs extraction, optional GitHub enrichment, scoring, and storage.
4. The browser listens for Server-Sent Events and falls back to polling.
5. Clarification answers start another round while retaining earlier evidence.
6. Finalization queues separate client and engineer jobs.
7. The last successful job reconciles both documents and records a version.
8. The user can edit, export, share, approve, or compare the result.

### Presentation layer

The interface uses Next.js, React, TypeScript, Tailwind CSS, Framer Motion, GSAP, and reusable components. React Query manages server state. The chat screen presents input, sample prompts, pipeline status, elapsed time, clarification controls, and recoverable errors. Output screens render sanitized Markdown and provide editing, copying, exporting, sharing, and approval actions.

### API layer

Next.js route handlers form the application boundary. Routes use Zod schemas, viewer resolution, ownership and capability checks, rate limits, and typed errors. The API does not wait for a complete pipeline; it records the transition and returns a status the interface can follow.

### Intelligence layer

The pipeline is separated into extraction, GitHub enrichment, module merging, question generation, finalization, reconciliation, scoring, risk detection, and effort estimation. Shared schemas connect prompts, validation, storage, tests, and the interface.

### Persistence and coordination

Postgres stores durable product data. Redis stores locks, live events, counters, budgets, and caches. QStash delivers background jobs in production. Local development can use PGlite, in-memory coordination, and Next.js `after()`.

### External services

Vercel hosts the application, Neon hosts Postgres, Upstash provides Redis and QStash, GitHub supplies public repository evidence, and OpenRouter-compatible providers perform structured inference. Auth.js with a Drizzle adapter supports optional sign-in.

## Complete processing workflow

### Stage 1 Input handling

Plain text and Markdown are decoded directly. DOCX content is extracted with Mammoth, and PDF text is read with the PDF parser. MIME type, extension, size, and resulting text are validated. Password-protected files and unsupported formats are rejected. The file exists only for that request; the browser receives extracted text for review.

### Stage 2 Session creation

The API creates a session with ownership, input, timestamps, round state, confidence zero, and a pending stage. Anonymous viewers receive a secure identifier in a cookie. Signed-in projects belong to a personal or selected workspace. The session is saved before the first model request, so a provider failure does not discard the brief.

### Stage 3 Structured extraction

The extraction prompt contains the requirement definitions and tool schema. User text appears inside explicit boundaries and is treated as data. The structured result includes domain, domain confidence, nine parameter states, evidence, gaps, candidate modules, module sizes, a clarity read, a clarity explanation, and blocker details.

The clarity read is not the displayed confidence. It records how clearly the model interpreted the text and becomes one limited input to the server calculation.

### Stage 4 Validation and repair

Zod validates every result. A malformed tool call, missing field, wrong type, wrapper object, or truncated response cannot enter storage directly. The structured-call helper can coerce common free-model formatting mistakes and make a bounded repair request. Repaired output must pass the original schema.

Repair is deliberately limited. Repeated repair can consume quota without improving output. Continued failure becomes a saved retryable error.

### Stage 5 GitHub enrichment

Search variants are derived from domain, features, modules, and technology constraints. Candidate lists are fused and ranked before expensive README work. Only the strongest candidates receive deep analysis; repository trees provide additional evidence without another model call for every result.

### Stage 6 Deterministic scoring and exit

Server code calculates scope and module confidence and applies blocker caps. Clarification normally stops at a score of 70, after the configured round limit, or after diminishing gains. Missing goal or core features can cap the score at 40; missing target users caps it at 65.

### Stage 7 Clarification

The question generator receives the extraction, evidence, gaps, and confidence. It prioritizes blockers and high-impact gaps. Answers are stored as a new round rather than replacing the original brief. GitHub evidence can be reused when the domain remains stable.

### Stage 8 Finalization and reconciliation

Client and engineer views run separately. The client view covers goals, modules, assumptions, exclusions, open decisions, milestones, and confidence. The engineering view adds architecture, data, integrations, security, tests, dependencies, risks, effort, sprints, and repositories.

Deterministic reconciliation restores validated modules and computed confidence, aligns milestones, applies hard-constraint caps, and replaces model-invented effort. The result becomes an immutable version. Later editing creates another version rather than erasing the generated record.

## Language model integration

### Structured calls

Extraction, questions, and final documents use tool schemas. The provider must call a named tool with JSON. Zod then validates the object. Provider adapters convert different APIs into one internal response format.

### Provider tiers and key rotation

Aureon defines main and fast tiers. Main tasks include extraction and final documents. Fast tasks include bounded repository analysis. The OpenRouter adapter builds a unique key pool from main, fast, fallback, and legacy variables. The starting key rotates between calls. Main work prefers the main key, while fast work prefers the fast key.

If a key returns authentication failure, permission failure, rate limiting, a retryable provider status, or a network failure, the adapter can move to the next key. Production currently uses three OpenRouter credentials. Rotation improves availability, but it cannot guarantee that a shared free model has capacity.

### Timeouts retries and budget

Each OpenRouter attempt has a 45-second timeout. Transient failures receive bounded backoff and jitter. A 429 moves to another key instead of repeatedly spending the same account quota. Pipeline deadlines stop work that cannot finish inside the execution window.

The application counts logical model operations with a daily budget. This protects the project even when a provider adapter retries or changes keys. Budget exhaustion becomes a non-retryable error until reset.

### Calls in a typical cycle

A ready brief normally uses one extraction call, up to two README-analysis calls, and two finalization calls, or about five logical calls. Clarification adds question generation and another extraction. Schema repair and provider fallback may add physical provider requests. The application cannot display a reliable count of remaining free-provider calls because that quota is controlled outside Aureon.

### Failure behavior

Provider failures become typed errors. The saved project offers retry rather than losing input. Finalization retains a successful half while the failed half remains pending. An optional webhook can report the error without sending secrets or the complete brief.

## GitHub evidence retrieval

### Purpose and query generation

GitHub enrichment finds public projects containing patterns relevant to the scope. It is supporting evidence, not automatic code selection. Named query variants are built from domain, important features, modules, and stack terms instead of placing every term in one long query.

### Candidate fusion and ranking

Reciprocal-rank fusion combines a repository's positions across queries. Duplicates are removed. BM25 then ranks repository names, descriptions, and topics against the project vocabulary. This reduces the chance that a popular but generic dashboard outranks a smaller project matching the actual domain.

### README and folder evidence

The pipeline fetches README content and repository trees only for top candidates within a GitHub request budget of 26. A limited number of README files are analysed by the fast tier. Folder names such as `auth`, `payments`, `inventory`, or `reporting` are normalized into module evidence.

Low-similarity repositories are excluded from validation and final references. Retained evidence contains URLs, similarity, modules, and folders. Final documents cannot invent links because reconciliation accepts only repositories already present in this evidence.

### Security and limitations

README text is untrusted, delimited in prompts, and unable to replace system instructions. Aureon reads public metadata and text but does not clone or execute repository code. The current ranking is lexical; different vocabulary can hide a useful repository. A repository match is not a licence, maintenance, or security audit.

## Confidence scoring

### Why scoring moved into code

An early design allowed the model to provide the displayed confidence. The same brief could move above or below the finalization threshold on different runs. We replaced that behavior with a pure server-side function based on validated inputs.

### Coverage calculation

Each parameter has a weight. Project goal and core features carry weight 5, target users weight 4, technical constraints weight 3.5, integrations weight 2.5, non-functional needs, budget, and timeline weight 2, and success criteria weight 1.

State multipliers are 1 for present, 0.7 for deeply partial, 0.3 for thinly partial, and 0 for missing. Weighted coverage is the sum of weight multiplied by state multiplier, divided by total weight, expressed from 0 to 100.

### Final score formula

Coverage contributes 75 percent and the model clarity read contributes 25 percent. A disagreement penalty equals 15 percent of the absolute difference between those values. GitHub corroboration can add at most five points.

`raw = 0.75 × coverage + 0.25 × clarity - 0.15 × |coverage - clarity| + GitHub bonus`

The displayed score is rounded and limited by any applicable cap. Consistency is `100 - |coverage - clarity|`; it is shown as a diagnostic but does not create free points.

### Caps and exit rules

If the extraction reports a blocker or project goal or core features are missing, the score cannot exceed 40. If target users are missing, it cannot exceed 65. Clarification normally stops at 70 or higher. It can also stop after three clarification rounds or when two consecutive gains are below four points. A session can store at most ten total rounds.

Confidence is a completeness and clarity indicator, not a probability that the project will succeed. It does not measure developer skill, market demand, or future implementation quality.

## Module confidence

Each proposed module receives a separate score from zero to one:

`module confidence = 0.45 × parameter signal + 0.35 × GitHub frequency + 0.20 × domain template match`

The parameter signal uses the strongest requirement evidence naming the module, with core features as a fallback. GitHub frequency measures how often relevant repositories contain the module, weighted by similarity. Template match checks whether the module is expected for the domain or is a recognized synonym.

A score above 0.80 is high, below 0.55 is low, and values between them are medium. The client view can therefore separate strongly supported modules from candidates that need confirmation.

## Risk analysis

Risk detection is implemented as code rather than free-form model judgment. Rules check for missing blockers, uncertain integrations, payment scope, authentication and roles, non-functional gaps, compressed timelines, large module counts, and domains with compliance concerns.

Fintech and healthcare receive explicit compliance warnings because regulatory and data-handling decisions affect architecture even when the brief omits them. More than 20 modules triggers a scope-expansion risk. The engineering document explains these risks, but server rules determine their identifiers and severity.

## Effort estimation

### Points and domain complexity

Small modules begin at 8 points, medium modules at 21, and large modules at 40. The sum is multiplied by a domain factor: fintech 1.4, healthcare 1.35, marketplace 1.25, SaaS 1.1, internal tools 0.85, and 1 for other domains.

### Team velocity and estimate range

The default team size is three when none is stated. Velocity is 13 points for one person, 26 for up to three, 45 for up to six, and 60 for up to ten. Larger teams do not keep increasing single-scope velocity because coordination overhead grows.

At confidence 80 or higher, the estimate band is plus or minus 20 percent. From 60 to 79, it is plus or minus 35 percent. Below 60, it is labelled unreliable and the user is advised to clarify first.

The server calculates sprint count and a bounded breakdown. The model can explain the estimate, but the server replaces any model-invented number. Actual effort can later be recorded for calibration, although the internship dataset is too small to claim a validated forecasting model.

## Data model

### Identity and workspaces

The `users`, `accounts`, `auth_sessions`, and `verification_tokens` tables support Auth.js. `workspaces` and `workspace_members` provide owner, editor, and viewer roles. Server-side capability checks protect each action; hiding a button is not treated as authorization.

### Projects and rounds

The `projects` table stores current state, ownership, original input, confidence, final output, draft output, errors, and timestamps. The `rounds` table preserves each clarification stage and extraction. This makes it possible to understand how the scope changed.

### Versions approvals and shares

The `versions` table stores immutable generated, edited, or clarified documents with their confidence at that time. `approvals` records pending, approved, and changes-requested decisions. Approval can lock the relevant version instead of allowing approved content to change silently.

The `shares` table links a protected token to a specific version, view or approval mode, expiry, and revocation status. A shared link grants access to one artifact, not the entire workspace.

### Usage audit and actuals

`llm_usage` records model usage for operations. `audit_log` records actions such as deletion, revocation, approval, and retention cleanup. `project_actuals` stores delivered effort for later calibration. Logs avoid provider keys and the full raw brief.

## Project lifecycle

A project moves through explicit states: created, processing a round, awaiting clarification, ready, finalizing, finalized, or failed with a retryable or non-retryable reason. `pipeline_stage` gives more detail, such as extraction, GitHub, scoring, clarification, or output.

Every important transition is persisted. A reload reconstructs the experience from server state. If QStash delivers a job twice, an idempotent claim prevents duplicate work. A stale job that no longer owns the session lock exits without overwriting newer state.

## User interface

### Intake and pipeline

The chat page uses a two-part layout. The left side shows Extract, GitHub, Score, Clarify, and Output. The main area contains sample briefs, text or file input, byte count, and supported-content guidance.

The user can start without signing in. During evaluation, anonymous access allows a judge to test the central workflow without account setup. While processing, the input is locked to avoid duplicate work. Stage labels, elapsed time, and saved status explain what is happening.

### Clarification and recovery

Questions present clear choices with a custom answer path. Earlier answers stay in project history. If the model service fails, the interface explains that the work was saved and offers retry.

### Output and review

The output page separates client and engineering views. Users can switch views, copy sections, edit Markdown, save versions, compare changes, export files, create share links, and request approval. Unsaved-change protection reduces accidental loss.

### Motion and accessibility

Framer Motion and GSAP communicate progress and hierarchy. Core controls remain standard HTML elements. The interface includes keyboard paths, focus behavior, readable contrast, and reduced-motion handling. A complete external accessibility audit remains future work.

## API design

The API is organized around resources and transitions:

- Session routes create and read projects.
- Run, answer, and describe routes start controlled changes.
- Finalize queues client and engineer jobs.
- Event routes stream progress.
- Project routes list, rename, duplicate, delete, export, and manage actuals.
- Version routes return immutable history.
- Share routes create, read, revoke, and decide on review links.
- Workspace routes manage settings and membership.
- Import routes extract file text.
- Health and retention routes support operations.

Routes return a consistent error shape rather than raw provider responses. Sensitive details stay in server logs, while the browser receives an actionable message and retry status.

## Background jobs and live progress

### Why jobs were introduced

Free model calls can take tens of seconds. Holding one browser request open for the whole pipeline caused timeouts and poor refresh recovery. The API now saves the transition and queues work.

### Production and local transport

Production publishes jobs in a QStash batch. Callback endpoints verify current and next signing keys. Each delivery carries the job type, session identifier, and lock token rather than the raw brief. QStash retries failed delivery.

When QStash is absent, Next.js `after()` runs work after the response. This is useful locally but not durable because a process restart can lose it. Production checks therefore reject unsafe fallbacks unless explicitly overridden.

### Locks idempotency and events

A session lock prevents concurrent changes to the same project. A job claim prevents duplicate QStash delivery from spending a second model call. Lock tokens identify ownership, and stale workers do not update newer state.

The browser subscribes to Server-Sent Events and reconnects after interruption. Polling remains as a fallback because serverless connections can close and some networks interfere with streams.

## Security

### Secrets and validation

Model keys, database URLs, GitHub credentials, queue tokens, Redis credentials, email credentials, and session secrets remain server-only. `.env.local` is ignored by Git. Zod validates API bodies, route identifiers, imported text, model output, and stored-state boundaries. Length limits apply before text enters prompts.

### Authorization

Every protected read or mutation resolves the viewer and checks project ownership, workspace membership, or share capability. Anonymous identifiers are credentials and are not accepted from arbitrary request fields. Share tokens can expire and be revoked.

### Prompt injection and browser protections

User and repository text are marked as untrusted data. Tool schemas constrain responses. Retrieved text cannot modify configuration or create unvalidated repository links. The browser uses a nonce-based Content Security Policy and security headers. Generated Markdown is sanitized, and credentials never enter client bundles.

### Abuse and spending

Rate limits are separated by action. Pipeline starts, reads, event streams, and exports do not share one counter. Daily budgets, locks, and idempotent jobs stop retries or double clicks from multiplying provider cost.

The threat model covers credential exposure, prompt injection, malicious files, forged queue jobs, unauthorized access, share-token leakage, forged client addresses, duplicate work, provider spending, conflicting documents, and retention failure.

## Privacy and retention

Imported files are read for one request and discarded after extraction. Aureon stores the reviewed text, not the original file. The default raw-input retention period is 90 days. A scheduled job blanks old raw input while preserving generated versions, approvals, and audit evidence.

This allows a team to retain the agreed scope without keeping the client's original message indefinitely. Project deletion is a separate explicit action. A commercial deployment would still require legal review of provider regions, contracts, and organization-specific retention.

## Reliability and observability

Structured logs record event, duration, job type, session identifier, outcome, and safe error details. Logs do not intentionally include keys or complete briefs. An optional webhook reports failures to an external monitoring destination.

Health checks verify the application process. The production runbook covers model failures, queue delivery, Redis, database access, rollback, backup, restore, and incident evidence. Session errors retain a code, timestamp, safe message, and retryability.

The application distinguishes provider outage, validation failure, and budget exhaustion. Retrying can help a network error but cannot fix an exhausted daily budget.

## Testing strategy

### Unit tests

Unit tests cover confidence, module scoring, effort, risk, BM25, search queries, prompt boundaries, output consistency, provider routing, OpenRouter parsing, Gemini compatibility, budgets, timeouts, environment validation, client IP handling, CSP, Markdown, imports, exports, calibration, polling, and error presentation.

### Integration tests

Integration tests cover session creation, extraction rounds, blocker behavior, clarification, GitHub enrichment, ownership, authorization, rate limits, locks, jobs, duplicate delivery, recovery, versions, shares, approvals, exports, actuals, calibration, retention, storage safety, and pipeline load.

### Browser tests

Playwright covers entering a brief, clarification, low-confidence generation, file import, output editing, save and reload, copy, export, rename, autosave, and unsaved-change protection.

### Isolation and evaluation

Normal tests use dummy credentials and block non-local network requests. Providers and GitHub are mocked, preventing credit use and flaky external behavior. Separate commands run deliberate live evaluations.

The repository includes 30 labelled brief cases and GitHub relevance cases. The labels remain drafts, so we do not publish an accuracy percentage without independent review.

### Verified submission results

On 21 November 2026:

- 77 test files passed.
- 1,086 tests passed.
- TypeScript checking passed.
- ESLint passed.
- Prettier checks passed.
- The Next.js production build passed.
- A tracked-secret scan found no OpenRouter or GitHub token patterns.

These results verify specified behavior; they do not prove every free-provider response or repository recommendation will be correct.

## Deployment and operations

### Hosted system

The application runs on Vercel at https://aureon-gp1k.vercel.app. Neon hosts Postgres. Upstash Redis provides distributed coordination, and QStash delivers durable jobs. Local development can use PGlite, process memory, and `after()`, but those fallbacks are not considered safe production infrastructure.

### Environment groups

Production variables cover:

- Database connection and session secret.
- Main, fast, and fallback model credentials and model names.
- Redis REST credentials.
- QStash token and current and next signing keys.
- Jobs base URL and optional Vercel automation bypass.
- Fine-grained GitHub token.
- Authentication and email settings when sign-in is enabled.
- Retention cron secret.
- Optional error webhook.

Environment validation checks incompatible combinations. A configured QStash token requires signing keys, and production storage should not silently fall back to process memory.

### Backup restore and release

The runbook requires a provider backup or `pg_dump`, restoration to an isolated database or Neon branch, migration verification, row counts, opening a restored project, and exporting both document formats. The recovery copy is deleted according to retention after evidence is recorded.

A release should pass formatting, linting, type checking, tests, production build, migration review, secret scanning, health verification, one controlled scope run, GitHub evidence review, export, and queue and database monitoring.

## Seven-month development record

### Month One Problem study and workflow

We studied how early software requests arrive as messages, notes, and feature lists rather than formal specifications. We mapped discovery into nine parameters and defined the first flow: brief, extraction, clarification, and two outputs. Separate client and engineering views were chosen because one document could not serve both audiences well.

The first prototype focused on text input and a visible pipeline. It proved the interaction but behaved like a temporary chatbot. There was no durable history, and responses were too free-form for reliable scoring.

### Month Two Structured extraction and clarification

We replaced unrestricted extraction with schemas for domains, parameters, states, modules, questions, sessions, and documents. Evidence and gap fields made every classification reviewable. Goal and core features became blockers, and target users became critical.

The question generator was limited to current missing or partial information. Exit rules prevented an endless interview. A static fallback question handled unusable model output.

### Month Three GitHub evidence and scoring

We added public GitHub retrieval. The first approach analysed too many README files and favored popular but weakly related projects. We introduced query variants, reciprocal-rank fusion, BM25, a request budget, a similarity threshold, limited deep analysis, and folder evidence.

We also removed the model's control over confidence. Scope confidence, module confidence, risks, and effort became deterministic functions, making results reproducible and tests meaningful.

### Month Four Persistence and history

We introduced Postgres through Drizzle, project and round storage, Auth.js tables, workspaces, role capabilities, anonymous ownership, and project claiming after sign-in.

Immutable versions, comparison, approvals, revocable shares, audit events, duplication, deletion, and retention changed Aureon from a temporary session into a project application. PGlite supported local work and integration tests.

### Month Five Documents editing and export

We separated client and engineering generation and added reconciliation. We built Markdown editing, drafts, autosave behavior, unsaved-change warnings, copy actions, versions, and comparisons. Export expanded to DOCX plus Jira and Linear CSV files.

TXT, Markdown, PDF, and DOCX import was added. Extracted text returns to the input box first so parsing errors can be corrected.

### Month Six Reliability security and tests

Long work moved from browser requests into background jobs. We added QStash, local `after()`, locks, job claims, partial finalization storage, retryable errors, Server-Sent Events, polling fallback, separate rate limits, budgets, timeouts, strict environment checks, CSP, sanitization, privacy pages, retention, logs, and error reporting.

The suite expanded across unit, integration, and browser layers. Normal tests block external networks. The threat model and runbook document operational controls.

### Month Seven Routing deployment and submission

We addressed free-provider limits with main and fast tiers, fallback routing, three-key rotation, provider-specific retry, structured-output recovery, and deterministic fallback behavior. A 429 now moves to another key instead of repeatedly retrying the exhausted account.

We configured Vercel, Neon, Redis, QStash, GitHub, and anonymous evaluation. Deployment diagnostics and recovery procedures were checked. Obsolete rendered reports, internal prompts, and working files were removed from the public branch. We prepared the README, presentation, video, report, and final verification.

## Major engineering changes

| Earlier behavior                     | Implemented change                     | Reason                               |
| ------------------------------------ | -------------------------------------- | ------------------------------------ |
| Model supplied displayed confidence  | Deterministic server score             | Repeatable results and tests         |
| GitHub links could be model-authored | Links restricted to API evidence       | Prevented invented repositories      |
| Many READMEs were analysed           | BM25 and limited deep analysis         | Reduced latency and calls            |
| Long work ran in browser requests    | QStash background jobs                 | Avoided timeouts and preserved state |
| Duplicate delivery repeated work     | Locks and idempotent claims            | Protected quota and newer state      |
| One provider route handled all work  | Main fast fallback routes and rotation | Isolated cost and failures           |
| One finalization failure lost output | Each document half saved separately    | Retry only the failed part           |
| Output was terminal                  | Editing versions sharing and approval  | Supported review and change control  |
| Raw input shared output retention    | Raw brief can be blanked separately    | Reduced unnecessary retention        |
| Tests could call external services   | Mocks and a network guard              | Prevented credit use and flakiness   |

## Problems encountered and solutions

### Free-provider instability

The visible “AI service had a problem” error came from exhausted quota, 429 responses, overloaded free models, long generation, malformed tool calls, and truncated JSON. We added tiered routing, three-key rotation, timeouts, bounded retries, output coercion, schema repair, saved errors, and partial finalization recovery.

These controls reduce failures but cannot make a free upstream service deterministic. The report therefore separates application reliability from provider availability.

### Weak GitHub results

Broad searches returned generic dashboards. Query variants, rank fusion, BM25, topics, folder inspection, a similarity threshold, and validated references made the results more relevant and auditable.

### Arbitrary confidence

Model-authored numbers could not be reproduced. The current formula uses parameter weights, state multipliers, disagreement penalty, GitHub bonus, and hard caps, with components visible to the user.

### Serverless timeouts

One long HTTP request exceeded practical limits. Background jobs now return quickly, save each stage, stream progress, and allow durable delivery retry.

### Conflicting documents

Independent generation sometimes changed modules, timelines, or estimates. Reconciliation restores validated modules, caps conflict, aligns milestones, and overwrites generated estimate fields.

### Repository clutter

Rendered pages, superseded reports, work orders, and planning prompts were useful during development but made the public repository look unfinished. We removed them from the main branch while retaining the final report and README. Git history preserves deleted files.

## System design concepts implemented

- Modular separation of interface, API, domain, persistence, and integrations.
- Asynchronous processing for long tasks.
- At-least-once delivery with idempotent consumers.
- Distributed locking for concurrent session changes.
- Event streaming with polling fallback.
- Durable state transitions and recoverable errors.
- Schema-first boundaries around model output.
- Caching and bounded external request budgets.
- Rate limiting and daily spend control.
- Role-based access and capability checks.
- Immutable versions and audit records.
- Configurable retention and scheduled cleanup.
- Backup and isolated restore procedures.
- Local fallbacks with strict production guards.

## Clean-code practices

The repository uses strict TypeScript, Zod, small domain modules, path aliases, named errors, central configuration, shared types, automated formatting, and linting. Pure scoring functions are separate from network code. Provider adapters implement a shared interface. Route handlers delegate complex work to libraries.

Tests are grouped by unit, integration, and end-to-end purpose. Environment parsing is centralized. Comments explain non-obvious constraints such as queue delivery, confidence caps, and provider retries.

Further modularization may help if team size or traffic grows. A rewrite in another language would add complexity without solving the current provider-capacity and evaluation constraints.

## Product classification

A simple AI wrapper forwards a prompt and displays the response. Aureon uses AI, but it owns a larger requirements-engineering process: requirement schema, clarification state, GitHub retrieval, scoring, risk rules, effort, authorization, jobs, persistence, versions, approvals, exports, budgets, and recovery.

The model remains essential for varied language interpretation and document drafting. The accurate description is an AI-assisted requirements engineering and project scoping platform with retrieval and deterministic decision support.

## Current limitations

- Free model capacity and latency are unpredictable.
- Multiple keys do not guarantee shared-model availability.
- GitHub ranking is mainly lexical and based on limited README analysis.
- Repository matches are not licence or security approval.
- Scanned image-only PDFs require OCR.
- Evaluation labels require independent review before accuracy claims.
- Confidence measures completeness, not project success.
- Effort factors need actual delivery data for calibration.
- Anonymous access would require tighter abuse controls at public scale.
- Accessibility has no independent audit.
- Jira and Linear are export-only.
- Review lacks live comments and simultaneous editing.
- The internship build has no production service-level agreement.

## Future work

The first priority is a model tier with predictable capacity. The second is independent review of evaluation labels followed by repeatable measurements of extraction, question quality, GitHub relevance, consistency, latency, and cost.

GitHub ranking can add license, maintenance, dependency health, size, and language signals. Semantic retrieval should be added only after the lexical baseline is measured.

Potential product work includes OCR, section comments, organization templates, two-way issue tracking, custom approval flows, and configurable scoring. A public version should also add centralized monitoring, service dashboards, scheduled restore drills, deployment smoke tests, cost alerts, and external security and accessibility reviews.

## Use of AI during development

AI coding tools assisted with reviewing code paths, suggesting tests, tracing errors, refactoring repeated logic, checking documentation, and diagnosing deployment configuration. We did not accept every suggestion. Changes were inspected, tested, and adjusted to match the project.

We do not describe the project as made without AI because that would be inaccurate. Our contribution was to define the problem, choose the workflow, integrate and constrain the models, implement the surrounding system, test behavior, diagnose failures, and prepare the final product.

## Learning outcomes

The project provided practical experience with requirements engineering, schema design, full-stack TypeScript, relational modelling, authentication, public APIs, background queues, Redis coordination, serverless limits, provider failure, exports, testing, deployment, and recovery planning.

The main lesson was that an AI feature becomes a dependable product only when the surrounding application handles uncertainty. Validation, deterministic rules, saved state, budgets, and human review mattered more than repeatedly changing the prompt.

## Conclusion

Aureon demonstrates an end-to-end requirements-scoping workflow. It accepts incomplete material, converts it into a consistent structure, retrieves public evidence, asks focused questions, and produces coordinated documents for clients and engineers.

The project records uncertainty instead of hiding it. Caps prevent a missing goal or feature set from looking ready. Estimates include reliability bands. Repository links remain evidence, not automatic recommendations. Provider failures preserve the user's work.

The current build is suitable for internship evaluation and controlled internal testing. Its strongest contribution is the process around the generated document: evidence, gaps, clarification, scoring, versioning, approval, and recovery are visible and testable.

## Reproduction steps

1. Install Node.js 22 or newer.
2. Clone https://github.com/dglalithchandra/aureon.
3. Run `npm install`.
4. Copy `.env.example` to `.env.local`.
5. Add one supported model-provider key for live inference.
6. Optionally configure Postgres, Redis, QStash, GitHub, authentication, and error reporting.
7. Run `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm test`.
8. Run `npm run dev`.
9. Open `http://localhost:3000/chat`.
10. Submit a brief, answer clarification questions, review GitHub evidence, generate both documents, and test export and sharing.

Automated tests do not require live credentials. A real pipeline run requires a valid key and remains subject to provider availability.

## Submission evidence

- Live application: https://aureon-gp1k.vercel.app
- GitHub repository: https://github.com/dglalithchandra/aureon
- Demonstration video: https://youtu.be/rT2Ah1Cq8zs
- Project report: `PROJECT_REPORT.md` and the formatted submission PDF

## Suggested evaluator checks

1. Open the live application and select a sample brief.
2. Confirm that pipeline stages update without a reload.
3. Use an incomplete brief and verify that Aureon asks a material question.
4. Review the confidence breakdown and blocker cap.
5. Compare GitHub references with the domain and modules.
6. Generate and compare client and engineering views.
7. Edit a document, save a version, and inspect the difference.
8. Export a document and create a share link.
9. Review the README, architecture notes, threat model, runbook, tests, and Git history.

## Final project status

The source repository, deployed application, demonstration video, presentation, detailed report, and verification evidence are ready for submission. The central workflow is implemented and tested. Remaining limitations are documented rather than presented as completed production capabilities.
