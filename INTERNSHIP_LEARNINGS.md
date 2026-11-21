# What We Learned While Building Aureon

## About this document

This document records the main lessons we learned while building Aureon during our internship. It is written from our perspective as a two-member student team. The project began as an idea for improving incomplete client requirements and gradually became a full-stack application with language models, GitHub retrieval, deterministic scoring, persistence, background processing, testing, security controls, and deployment.

The most important lesson was that building an AI feature is different from building a dependable AI product. A model can generate an impressive response, but a working product must also validate that response, preserve state, handle failure, control cost, protect user data, and explain uncertainty.

## Understanding the problem before building

We learned that implementation should not begin with the technology stack. It should begin with a clear description of the problem and the people affected by it.

Early software requests are usually incomplete. Clients explain visible features but may not mention permissions, integrations, performance, security, budget, timeline, or success criteria. Developers then make assumptions. Those assumptions can become expensive when they are discovered after development begins.

This led us to define Aureon's main purpose: create a controlled discovery step between an informal brief and an engineering plan. Defining this purpose helped us reject features that did not support the core workflow.

## Requirements engineering

We learned how to separate a requirement into what is confirmed, what is partially described, and what is missing. Aureon evaluates nine areas: project goal, users, core features, technical constraints, integrations, non-functional requirements, budget, timeline, and success criteria.

Using the same structure for every project made the output easier to compare and test. Evidence and gap fields were also important. A classification is more useful when the system can show which part of the brief supported it and what information is still required.

We also learned that clarification questions should be selective. Asking every possible question makes discovery feel like a long form. A good question should resolve a decision that changes scope, architecture, effort, risk, or acceptance.

## Designing an AI-assisted workflow

At first, it was tempting to treat the language model as the complete solution. During development we learned to assign different responsibilities to the model and the application.

The model is useful for interpreting varied human language, identifying candidate modules, drafting clarification questions, analysing a small amount of repository text, and writing client and engineering documents. The application is better suited for schema validation, confidence scoring, caps, risks, estimates, authorization, storage, rate limits, and recovery.

This division made the system easier to reason about. It also made failures less damaging because the model could not directly change ownership, budgets, confidence caps, or stored project history.

## Structured outputs and schema validation

We learned that free-form model responses are difficult to use inside an application. A response may omit a field, change a property name, return the wrong type, wrap JSON in extra text, or stop because the token limit was reached.

Aureon uses tool schemas and Zod validation. The provider is asked to return a structured object, and the server validates it before storage. Common formatting mistakes can be coerced or repaired, but repaired output must pass the original schema.

This taught us to treat model output like any other untrusted external input. A response should not be trusted simply because it is grammatically correct.

## Prompt design

We learned that prompts work better when they describe a narrow responsibility, provide a clear schema, define what must not be assumed, and separate user text from system instructions.

Long prompts are not automatically better. Extra instructions can conflict or distract from the important rules. We had better results when prompts were supported by code-level validation rather than trying to describe every safeguard in natural language.

We also learned that repository README files and uploaded client text may contain instructions. They must be marked as untrusted data and must not be allowed to replace the system prompt.

## Deterministic confidence scoring

One of our most important changes was moving confidence out of the model and into server-side code.

When a model supplied its own score, the same brief could receive different values on different runs. That made the finalization threshold difficult to trust. The current score uses weighted requirement coverage, a limited model clarity component, a disagreement penalty, a small GitHub corroboration bonus, and hard caps for missing critical information.

We learned that a useful confidence score needs a defined meaning. Aureon's score measures the completeness and clarity of the current scope. It is not the probability that the project will succeed, and it does not measure developer ability or market demand.

## GitHub retrieval and ranking

We learned that searching GitHub is not the same as finding the most popular repository. Broad queries often returned projects that shared words such as “dashboard” but were not useful implementation references.

We improved retrieval by building multiple query variants, combining rankings with reciprocal-rank fusion, and applying BM25 before deeper analysis. Only strong candidates receive README analysis, while folder names provide additional evidence with fewer model calls.

This work taught us that retrieval quality depends on query design, ranking, evidence thresholds, and evaluation. We also learned that a repository match is only a reference. It is not proof of security, quality, compatibility, maintenance, or licensing suitability.

## Full-stack application development

Building Aureon improved our understanding of how the browser, API routes, domain logic, storage, and external services work together.

We used Next.js and React for the interface, TypeScript for shared types, Zod for validation, and Drizzle for database access. We learned to keep route handlers small and move scoring, provider logic, storage, exports, and authorization into focused modules.

We also learned that a page reload should not destroy an important workflow. The server must remain the source of truth for project status, rounds, errors, drafts, and final output.

## Database design and project history

The project taught us to think beyond storing one final response. Aureon needs users, workspaces, memberships, projects, rounds, versions, shares, approvals, usage records, audit events, and actual effort.

Rounds preserve the development of a scope. Versions preserve generated, edited, and clarified documents. Approval belongs to a specific version because approved content should not change silently. Share links also refer to a controlled artifact rather than opening the entire workspace.

We learned that data retention is part of database design. Raw client input can have a shorter lifetime than the generated scope and approval record.

## Background jobs and serverless limits

Long model calls initially ran inside browser-facing requests. This caused timeouts and made the interface appear stuck.

Moving work into background jobs taught us about asynchronous processing. The API stores the transition and returns quickly. QStash delivers the job, while Server-Sent Events or polling reports progress to the browser.

We learned about at-least-once delivery: a queue can deliver the same job more than once. Idempotent claims prevent duplicate work, and session locks prevent concurrent actions from overwriting each other. A stale worker should stop when it no longer owns the lock.

## Working with unreliable model providers

Free model services were one of the hardest parts of the project. We encountered rate limits, overloaded models, authentication errors, slow responses, truncated JSON, and malformed tool calls.

We added main and fast task tiers, a fallback route, key rotation, bounded retry, per-attempt timeouts, logical-call budgets, saved errors, and partial finalization recovery. A successful client document is retained even if the engineering document fails.

We learned that rotating keys can reduce the effect of one account's quota, but it cannot guarantee capacity on a shared free model. A production service requires a provider plan with predictable limits and clear terms.

## Security

The project helped us understand that security must be included throughout the architecture.

Secrets stay in server-side environment variables. API requests and model responses are validated. Project reads and writes check ownership or workspace capability. Share tokens can expire or be revoked. QStash callbacks require signature verification. Generated Markdown is sanitized, and browser security headers restrict content execution.

We also considered prompt injection, forged client addresses, malicious files, duplicate jobs, uncontrolled provider spending, accidental data retention, and leakage through logs. Writing a threat model helped us connect each risk to a code or operational control.

## Privacy and retention

We learned that users may paste confidential project information even when the application asks them not to. Aureon therefore does not store uploaded files after extraction and separates raw-input retention from generated output.

This taught us that privacy is not only a policy page. It affects data models, logs, exports, provider selection, deletion behavior, and operational procedures.

## Testing

Testing became a major part of the project. Pure scoring functions were easier to test than prompt-only rules. Unit tests cover calculations and adapters, integration tests cover routes and database state, and browser tests cover the user journey.

We learned to block external network requests during normal tests. This prevents accidental API spending, avoids dependence on provider availability, and keeps results repeatable. Live evaluations should be separate and deliberate.

We also learned to be careful when reporting accuracy. The project includes labelled evaluation cases, but draft labels are not enough to support a public accuracy claim. Ground truth must be independently reviewed.

## Document generation and consistency

Producing separate client and engineering documents taught us that two model calls can disagree even when they receive the same project state. Modules, timelines, and estimates can drift.

We added a consistency layer that restores validated modules, computed confidence, and server-calculated effort. This showed us that generated documents need post-processing and reconciliation before they become reliable project records.

## Deployment and operations

Deploying Aureon taught us how local and hosted environments differ. Local fallbacks such as PGlite, process memory, and `after()` are convenient, but production needs durable Postgres, distributed Redis, signed queue delivery, and correct environment variables.

We learned to run formatting, linting, type checking, tests, migrations, production builds, secret scans, health checks, and controlled smoke tests before release.

The backup and restore procedure also changed our understanding of reliability. A configured backup is not enough; a team should restore it into an isolated environment, check migrations and row counts, open a project, and verify exports.

## User experience and communication

The application needed to explain long-running work without making the user think it had frozen. Pipeline stages, elapsed time, saved progress, and retry messages made the process easier to understand.

We learned that error messages should explain what happened to the user's work. “The AI service had a problem” is less useful unless the application also confirms that the brief and answers were saved and tells the user whether retry is possible.

Maintaining two output views also taught us to write for the reader. Clients need goals, outcomes, assumptions, and decisions. Engineers need architecture, modules, data, security, tests, risks, and estimates.

## Clean code and maintainability

We learned the value of central configuration, shared schemas, small modules, named errors, and automated formatting. Important formulas should have one source of truth. Provider-specific behavior should stay inside adapters. Route handlers should coordinate rather than contain the entire application.

Comments are useful when they explain why a constraint exists, such as why 429 rotates immediately or why a stale job must stop. Comments that only repeat the code are less helpful.

## Teamwork

Working as a two-member team required us to discuss the expected behavior before changing code. We learned to divide work by responsibility while reviewing decisions together. Shared documentation and Git history made it easier to understand changes made by the other person.

We also learned that completing a feature includes testing, error handling, documentation, and deployment configuration. A feature is not complete only because its main interface works once.

## Using AI coding tools responsibly

AI coding tools helped us review code paths, suggest tests, trace failures, refactor repeated logic, and check documentation. They also sometimes proposed changes that did not match the current framework version or project constraints.

We learned to inspect suggestions, read the actual code and documentation, run tests, and keep responsibility for the result. We have described this use honestly rather than presenting the project as built without AI.

## Professional learning

The internship gave us experience in moving from an idea to a deployed and documented application. We learned to explain technical decisions to different audiences, record limitations, avoid unsupported claims, prepare evaluation evidence, and think about maintenance after submission.

We also learned that a strong project report should explain why decisions were made, what evidence supports them, which parts were tested, and which parts remain uncertain.

## What we would improve next

Our next priorities would be a model provider with predictable capacity and an independently reviewed evaluation baseline. After that, we would improve GitHub relevance signals, add OCR for scanned documents, strengthen accessibility testing, schedule restore drills, add centralized monitoring, and collect real project outcomes for estimate calibration.

We would add larger features such as live collaboration or two-way issue tracking only after real users confirm that they need them.

## Final reflection

Aureon taught us that the visible AI response is only one part of an AI application. The less visible parts - validation, deterministic rules, persistence, authorization, jobs, budgets, testing, observability, and recovery - determine whether the system can be trusted.

We are thankful for the internship opportunity because it allowed us to apply classroom concepts to a working product, encounter real implementation failures, and improve the system through testing and review. The experience strengthened both our technical knowledge and our understanding of how software should be planned, communicated, and maintained.
