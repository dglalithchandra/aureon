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

## Abstract

Aureon is a web application for turning incomplete client briefs into structured project scopes. The input may be pasted as text or imported from a TXT, Markdown, PDF, or DOCX file. The system extracts nine requirement areas, identifies gaps, searches public GitHub repositories for relevant implementation references, calculates confidence with server-side rules, and asks clarification questions when essential decisions are missing. Once the scope is ready, Aureon produces a client document and an engineering document from the same validated project state.

The project uses language models for interpretation and writing, but it does not allow the model to decide its own confidence or overwrite application rules. Confidence, blockers, module evidence, risks, effort estimates, rate limits, ownership, versions, and recovery are handled by code. This division makes the workflow easier to test and keeps important decisions visible.

## Problem statement

Small software projects often begin with a voice note, a chat message, a meeting summary, or a short list of features. These inputs rarely state every user role, integration, technical constraint, success measure, budget, or timeline. Engineers then fill the gaps with assumptions. The assumptions usually become visible only after development has started, when changing them costs time.

Aureon was built to place a review step between the first brief and implementation. It shows what the client has confirmed, what remains unclear, which questions matter, and what an engineering team would need to build the project.

## Objectives

- Convert unstructured project descriptions into a consistent requirement model.
- Separate confirmed information, partial information, assumptions, and missing decisions.
- Ask a small number of questions that materially change the scope.
- Use real public repositories as supporting references while treating their contents as untrusted input.
- Calculate confidence, risk, and effort using auditable application rules.
- Produce separate documents for clients and engineers without maintaining two unrelated sources.
- Preserve project versions, approvals, share links, and actual effort for later review.
- Run locally with simple fallbacks and deploy with durable hosted services.

## Implemented scope

The present version covers the complete path from raw input to editable output. It supports document import, structured extraction, GitHub enrichment, clarification rounds, deterministic scoring, final document generation, editing, comparison, approval, sharing, export, retention, and estimate calibration. It also includes production guards, structured logs, error reporting, rate limits, distributed locks, background jobs, and recovery paths.

The current version does not include OCR for scanned documents, semantic vector search, simultaneous co-editing, billing, or two-way Jira and Linear synchronization.

## Requirement model

Each analysis checks the same nine areas:

1. Project goal
2. Target users
3. Core features
4. Technical constraints
5. Integrations
6. Non-functional requirements
7. Budget
8. Timeline
9. Success criteria

Every area is marked as present, partial, or missing. Evidence and gaps are stored with the state. A fluent paragraph cannot hide a missing project goal or undefined core feature because the exit rules inspect the structured states.

## System architecture

### User interface

The interface is built with Next.js, React, TypeScript, Tailwind CSS, GSAP, and Framer Motion. The chat page accepts requirements and shows the current pipeline stage, elapsed time, saved progress, clarification questions, and failures. The output area supports editing, comparison, approval, sharing, copying, and export.

### Application API

Next.js route handlers validate requests with Zod, identify the current viewer, enforce ownership, apply rate limits, and start background work. The API returns quickly with a job status instead of holding an HTTP request open during a long model call.

### Background processing

Production jobs are delivered through QStash and verified with signed requests. Local development uses Next.js `after()` when QStash is not configured. Each session has a lock, and each job has an idempotent claim, so repeated delivery or a double click does not start duplicate work. The browser receives progress through Server-Sent Events and falls back to polling when the stream closes.

### Intelligence pipeline

The intelligence layer contains provider routing, structured model calls, GitHub retrieval, deterministic scoring, risk analysis, and effort estimation. Main tasks and fast repository-analysis tasks may use different provider routes or credentials. Provider errors, rate limits, invalid structured output, and timeouts are handled without discarding saved project state.

### Data and operations

Postgres stores accounts, workspaces, sessions, rounds, outputs, versions, approvals, share links, and calibration records. Neon hosts the deployed database. Redis stores short-lived coordination data such as locks, caches, live events, rate-limit counters, and the daily model-call budget. Vercel hosts the application.

## Processing workflow

### Extraction

The first model call converts the brief into a structured object. The output must match a Zod schema. Invalid or truncated responses enter a bounded repair path and are checked against the same schema again. The application limits and delimits user text before it enters a prompt.

### GitHub evidence

The repository search creates several queries from the domain, features, modules, and technology hints. Results are combined with reciprocal-rank fusion and ranked again with BM25 over repository text. The strongest README files may be analysed for reusable modules, while repository folders provide additional evidence without another model call. Repository text is treated as untrusted content and cannot change system instructions.

### Confidence and clarification

The server calculates confidence from requirement coverage, extraction quality, agreement between signals, and a limited GitHub evidence bonus. Caps apply while essential information is missing. A blocker is raised when the goal or core functionality is too unclear to continue. Otherwise, the question generator focuses on partial or missing areas and stops after the configured clarification rounds.

### Final documents

Finalization runs the client and engineering documents as separate jobs. The client view explains outcomes, modules, assumptions, exclusions, and open decisions in plain language. The engineering view adds architecture, integrations, dependencies, security, tests, risks, effort points, sprint estimates, and GitHub references. Deterministic checks reconcile the independently generated views against the validated extraction.

## Model calls in one project cycle

The number of calls varies with the brief and the available GitHub evidence.

- A normal first round uses one extraction call and up to two README-analysis calls.
- If the scope is incomplete, one question-generation call is added.
- Each answered clarification starts another extraction round. GitHub results are reused unless the detected domain changes.
- Finalization uses two calls, one for each output view.
- A schema-repair attempt or provider fallback can add another provider request, but the daily budget counts and limits logical application calls.

A ready brief with two README analyses and both final documents normally uses five logical calls. A brief that needs questions and another extraction round uses more. This is why the application routes smaller repository tasks separately, caches enrichment, and enforces a daily limit.

## Seven month development record

The repository was published in September 2026, so Git commits do not provide a complete calendar diary of the earlier work. The following month-by-month record reconstructs the development sequence from the implemented system and repository history. It describes working phases rather than claiming that every change was committed on the day it was made.

### Month One Problem definition and first workflow

We began with the problem of incomplete client requirements. The first design mapped a brief into nine requirement areas and separated known information from gaps. We built the initial chat flow and decided that the output had to serve both a non-technical client and an engineering team.

### Month Two Structured extraction and clarification

The second phase moved the project away from free-form chatbot responses. We defined schemas for extraction and clarification, added evidence and gap fields, and limited clarification to decisions that affect scope. The blocker gate prevented the system from treating a brief as ready when the goal or core features were still missing.

### Month Three Evidence and scoring

We added GitHub repository retrieval to support the proposed modules with public implementation examples. Early retrieval was expensive because too many README files were analysed. We reduced deep analysis to the strongest candidates, kept folder evidence for the rest, cached results, and retained useful search links when the GitHub quota was exhausted. Confidence, risk, module confidence, and effort were moved into deterministic code so the model could not grade its own work.

### Month Four Persistence and project history

The application changed from a single temporary session into a project system. Postgres storage, workspaces, accounts, anonymous ownership, share links, immutable versions, approval decisions, scope comparison, retention, and deletion were added. PGlite provided a local database when a hosted connection was unavailable.

### Month Five Output editing and delivery

We made both documents editable and added unsaved-change protection, local draft handling, copy actions, and exports. Markdown and browser PDF exports were joined by server-generated Word documents and Jira and Linear CSV files. File import was added for TXT, Markdown, PDF, and DOCX documents, with the extracted text returned to the input box for review before a session was created.

### Month Six Reliability security and testing

Long model requests were moved into background jobs. We added session locks, idempotent claims, retryable error states, progress events, polling fallback, daily budgets, separate rate-limit buckets, strict environment validation, a nonce-based Content Security Policy, privacy and terms pages, and production storage guards. The test suite grew across unit, integration, and browser layers, with external network access blocked during normal automated tests.

### Month Seven Provider routing deployment and final hardening

The final phase focused on the limits of free model providers. We introduced separate main, fast, and fallback routes, a three-key production pool, key rotation for quota errors, timeouts, structured-output recovery, and deterministic fallback for an incomplete engineering document. We completed the Neon restore drill, deployed on Vercel, enabled anonymous evaluation access, recorded operational diagnostics, and prepared the report, presentation, and demonstration video.

## Important changes made during development

| Earlier behavior                                 | Change made                                                     | Reason                                               |
| ------------------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------- |
| The model supplied its own confidence score      | Confidence moved to server-side rules                           | The score needed to be repeatable and testable       |
| GitHub references could be model-authored        | References now come from the GitHub API                         | Links and repository facts must be verifiable        |
| Several README files were deeply analysed        | Deep analysis was limited to the strongest candidates           | Reduced latency and model usage                      |
| Long requests ran inside user-facing routes      | Work moved to background jobs                                   | Avoided platform timeouts and preserved progress     |
| Polling and API calls shared rate-limit behavior | Separate limits and SSE progress were introduced                | Prevented the interface from limiting itself         |
| Concurrent requests could duplicate work         | Session locks and job claims were added                         | Protected quota and stored state                     |
| Provider errors could leave a session stuck      | Retryable stored errors and recovery paths were added           | Allowed the user to continue without losing answers  |
| One provider and key handled all work            | Main, fast, and fallback routing with key rotation was added    | Isolated failures and distributed free-tier pressure |
| Output was a final answer                        | Editable versions, comparison, sharing, and approval were added | Supported a real review process                      |

## Security privacy and reliability

Secrets remain in server-side environment variables. The browser never receives model, database, GitHub, or queue credentials. Zod validates API input and model output. Ownership checks protect anonymous sessions and signed-in workspace projects. Share links are version-specific and may expire or be revoked.

Imported files exist in memory for one request and are discarded after text extraction. Raw client input has a separate retention policy from generated documents. Production configuration checks reject unsafe storage and unsupported free-model use unless an explicit override is set.

The threat model covers prompt injection, data exposure, forged client addresses, uncontrolled model spending, duplicate jobs, untrusted repository text, and unsafe file processing. The production runbook covers health checks, incidents, backup and restore, rollback, and release evidence.

## Testing and verification

On 21 November 2026, the automated suite completed successfully:

- 77 test files passed.
- 1,086 tests passed.
- The normal test suite used dummy credentials and blocked non-local network requests.

The tests cover scoring, blockers, effort, risk, provider routing, structured-output repair, budgets, timeouts, GitHub ranking, ownership, authorization, rate limits, locks, jobs, recovery, retention, imports, exports, sharing, approval, versions, actuals, calibration, and interface failure states.

Browser tests cover editing, reloading, clarification, low-confidence generation, file import, export, copy actions, autosave, rename behavior, and unsaved-change protection. The evaluation harness contains 30 labelled briefs, but the labels remain drafts and should be reviewed before publishing accuracy percentages.

## Deployment and configuration

The application is deployed on Vercel at https://aureon-gp1k.vercel.app. The deployed environment uses Neon Postgres, Upstash services, GitHub access, and OpenRouter model routing. Anonymous evaluation is enabled, so a reviewer does not need a username or password.

Production secrets must be configured in the deployment platform and must not be committed to Git. The main secret groups are the model-provider credentials, database connection, session secret, Redis credentials, QStash credentials, GitHub token, and optional error webhook.

## Use of AI during development

AI development tools assisted with code review suggestions, debugging, refactoring, test-case ideas, and documentation checks. We reviewed the proposed changes and kept responsibility for the requirements, architecture, data model, security decisions, acceptance criteria, testing, deployment, and submission. The AI used by the Aureon product is a separate runtime component whose output is validated and constrained by the application.

## Limitations

- Free model availability and latency are not predictable enough for a production service-level commitment.
- GitHub relevance ranking is lexical and some retrieved repositories are more useful than others.
- Scanned image-only PDFs are not supported because OCR is not implemented.
- Evaluation labels require independent review before accuracy figures are defensible.
- Accessibility basics are implemented, but a complete external audit is still needed.
- Jira and Linear integration is export-only.
- Shared review does not include live cursors, simultaneous editing, or comments.
- The internship version is an MVP and does not promise production reliability.

## Future work

The next practical improvement is a stable model tier with predictable capacity, followed by a reviewed evaluation baseline. GitHub ranking can be improved with a larger judged dataset and stronger repository-quality signals before considering embeddings. OCR should be added only if scanned documents become a real requirement. Live collaboration and two-way issue tracking are larger product decisions and should not be added until the core scoping workflow has been evaluated with real client briefs.

## Conclusion

Aureon demonstrates a complete requirements-scoping workflow rather than a single prompt wrapper. It combines structured model calls with GitHub retrieval, deterministic decisions, background processing, durable storage, editable documents, and operational controls. The project also shows the limits of free model infrastructure: a reliable application needs validation, state recovery, clear failure handling, budgets, and human review around every generated result.

The current build is suitable for internship evaluation and controlled internal testing. Its main value is the process it creates around uncertain requirements: the client and engineering team can see what is known, what is missing, what evidence supports the proposed scope, and what changed between versions.

## Submission evidence

- Live application: https://aureon-gp1k.vercel.app
- Source repository: https://github.com/dglalithchandra/aureon
- Demonstration video: https://youtu.be/rT2Ah1Cq8zs

## Reproduction steps

1. Install Node.js 22 or newer and clone the repository.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and add one supported model-provider key.
4. Run `npm run typecheck`, `npm run lint`, and `npm test`.
5. Start the application with `npm run dev` and open `http://localhost:3000/chat`.
6. Submit a detailed brief, answer any clarification questions, and compare the client and engineering views.

The automated suite does not require real credentials or spend model credits. A live pipeline demonstration does require a valid provider key and may be affected by free-tier availability.
