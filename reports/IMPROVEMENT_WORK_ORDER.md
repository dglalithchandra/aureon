# Aureon improvement plan and work order

Prepared: 6 November 2026  
Repository: `C:\Users\D Lalith Chandra\Desktop\scopeai`  
Status: proposed implementation backlog; application changes have not started under this plan.

## Objective and scoring rules

Target a documented 9/10 assessment in each area from the repository review. Ratings are judgments; completing tickets does not automatically award a score. Re-rate against demonstrated behavior and keep any failed area below target until evidence supports it.

The product objective is a dependable requirement-to-scope workflow for small software teams: preserve what the client requested, expose uncertainties, propose a manageable MVP, and produce consistent client and engineering documents with supporting evidence.

Do not interpret a scope-readiness score as the probability that a document is correct. Do not interpret a matched public repository as proof that a client needs a feature. Do not promise 100% model accuracy. Exact software invariants, such as shared requirement IDs across both views, can and should be enforced for every output.

## Verified starting point

- 70 automated test files and 1,038 tests passed in the 6 November review.
- The production dependency audit reported zero known vulnerabilities at that time.
- Both configured OpenRouter lanes returned a valid forced tool call in small live checks: main 1.305 seconds; fast 0.828 seconds. This is a connectivity check, not a full-pipeline latency baseline.
- Both lanes use the same configured free model. Three OpenRouter environment entries contain two distinct credentials.
- `GITHUB_TOKEN` is missing. The observed anonymous GitHub core allowance was 0 of 60 requests; its search allowance was separate.
- Hosted Postgres, shared Redis, QStash and login credentials are not configured locally. Their implementation and their deployment validation are separate matters.
- Browser tests can inherit main/fast provider overrides from `.env.local`, and can reuse an existing live server. They do not currently establish a trustworthy isolated browser baseline.
- A previously measured 167.9-second extraction cannot be called one HTTP attempt: the logged attempt count belongs to structured-output repair and omits adapter HTTP retries.
- Existing evaluation labels are drafts. There is no reviewed full-document quality baseline establishing production accuracy.

## Work rules

1. Preserve existing uncommitted work. Record the starting diff and include only relevant changes in each review unit; do not reset or clean the repository.
2. Read applicable bundled Next.js guides before changing framework code, as required by AGENTS.md.
3. Implement one work order at a time, with a reviewable diff, evidence and a handoff note. Source control commits or pushes need the user's instruction.
4. Keep automated tests isolated from real credentials and external inference. Run intentional live checks separately, with a stated call budget and synthetic or approved data.
5. Define success thresholds before evaluating a model. Keep holdout cases out of prompt tuning.
6. Prefer changes to the existing modular application. Microservices, Kubernetes and a vector database are not prerequisites for these improvements.
7. Migrate stored data compatibly and verify old projects still open. Test migrations and restoration on disposable data first.

## Work order summary

Effort estimates are focused developer-days, not calendar promises. Product decisions, account access, mentor review and completed-project data may add elapsed time.

| Order | Deliverable                                          | Depends on                                      | Main owner                 | Effort                      |
| ----- | ---------------------------------------------------- | ----------------------------------------------- | -------------------------- | --------------------------- |
| WO-00 | Baseline, product scope and evaluation agreement     | None                                            | Developer + user/mentor    | 0.5–1 day                   |
| WO-01 | Isolated and trustworthy tests                       | WO-00                                           | Developer                  | 1–2 days                    |
| WO-02 | Secret management and service readiness checks       | WO-00; live checks after WO-01                  | Developer + user           | 1–2 days                    |
| WO-03 | Reliable AI gateway and per-stage diagnostics        | WO-01, WO-02                                    | Developer                  | 2–3 days                    |
| WO-04 | Shared scope model and requirement traceability      | WO-00, WO-01                                    | Developer + mentor         | 2–4 days                    |
| WO-05 | Relevant, evidence-aware GitHub retrieval            | WO-02, WO-03, WO-04                             | Developer + reviewer       | 2–3 days                    |
| WO-06 | Consistent client and engineer outputs               | WO-03, WO-04; reference integration after WO-05 | Developer                  | 2–3 days                    |
| WO-07 | Explainable readiness and confidence evaluation      | WO-04, WO-05, WO-06                             | Developer + mentor         | 2–3 days                    |
| WO-08 | Honest effort estimates and stronger risk analysis   | WO-04, WO-06                                    | Developer + project owners | 2–3 days, plus real history |
| WO-09 | Usable workflow, accessibility and restrained motion | WO-03, WO-04, WO-06, WO-07                      | Developer + testers        | 2–3 days                    |
| WO-10 | Security, privacy and data lifecycle                 | WO-01, WO-02, WO-04, WO-06                      | Developer + user           | 2–3 days                    |
| WO-11 | Staging deployment, recovery and load baseline       | WO-03, WO-06, WO-10                             | Developer + user           | 2–3 days                    |
| WO-12 | Independent evaluation and release decision          | All relevant work orders                        | Developer + mentor/testers | 2–4 days                    |

Product interviews, test-case review and gathering actual project results should start during WO-00 and continue while implementation proceeds.

## WO-00 — Agree the product and preserve the baseline

### Work

- Record current changes, versions, environment-variable names, successful checks and known failures without secret values.
- Select an initial audience: proposed default is small agencies or student teams preparing web-app MVP proposals.
- Write a one-page product brief: user, problem, first workflow, MVP, exclusions and success measures.
- Select three representative scenarios, including a vague brief and a brief containing contradictions.
- Ask a mentor or independent reviewer to review the existing 30 draft labels. Reserve at least 20 additional unseen cases for the final evaluation.
- Define what counts as a requirement, acceptable assumption, unsupported addition, material omission and critical contradiction.

### Acceptance and evidence

- A reviewed product brief, baseline results and evaluation rubric exist.
- Each test case has an expected requirement list and a written reason for ambiguous judgments.
- The test set includes long inputs, non-English/Hinglish content, contradictory constraints and hostile source text.
- Product success is measured by time and corrections needed to reach an accepted scope, not by how many pages are generated.

## WO-01 — Repair test isolation first

### Work

- Explicitly force main and fast providers to the local mock and prevent fallback to a live provider in browser and mock-evaluation modes.
- Ensure `.env.local` cannot restore a real route after test configuration is applied.
- Stop Playwright from attaching to an unrelated server; verify a test-only identity before starting a suite.
- Use unique temporary database locations and distinct application/control ports; reliably stop child processes on success and failure.
- Block unexpected outbound AI/GitHub calls during automated tests, and supply deterministic GitHub responses for browser scenarios that need them.
- Diagnose repeated page refreshes from trace evidence before attributing them to database watching.

### Likely files

`scripts/e2e-server.ts`, `playwright.config.ts`, `tests/e2e/`, `tests/mocks/`, `evals/run.ts`, `tests/setup.ts`.

### Acceptance and evidence

- All current browser scenarios pass in isolated mode, including edits, reload, imports, exports and accessibility interactions.
- The suite proves that zero real AI or GitHub requests were made, even when real provider overrides exist in the developer environment.
- Ports and test data do not collide with a live local application.
- Run twice in succession to demonstrate clean teardown and repeatability; retain traces for failures.

## WO-02 — Configure and verify services safely

### Work

- Rotate credentials previously shared in chat; the user enters replacements directly in `.env.local` or deployment secrets.
- Consolidate duplicate settings and document precedence: tier-specific OpenRouter keys override the generic key.
- Add a token with the minimum access needed for public GitHub repository reads.
- Align the local application URL and chosen port; maintain separate local, staging and production settings.
- Add a protected service-readiness check for configuration, database access, provider authentication, GitHub quota and queue configuration.
- Make inference probes explicit, bounded actions. Do not spend model quota on every liveness request.
- Validate configured models and required tool capabilities. Document startup errors and how to resolve them.

### Acceptance and evidence

- Main and fast routes complete one small structured probe each with the intended model and credential alias.
- Authenticated GitHub search plus README and tree retrieval succeed for a known public repository.
- Only redacted aliases/statuses appear in diagnostics. No secrets appear in browser bundles, logs or version control.
- A missing/invalid credential yields an actionable configuration error without discarding user input.

### User input

Fresh AI credential(s), GitHub token, preferred local port and an agreed live-test usage budget. One working AI credential plus one GitHub token is sufficient for a basic local baseline; more AI credentials are optional.

## WO-03 — Bound AI work and make failures diagnosable

### Work

- Classify authentication, access/billing, daily quota, transient capacity, timeout and invalid-output errors separately.
- Retry only eligible failures; respect provider retry hints and use a total stage deadline covering HTTP retries and output repair.
- Add per-provider concurrency limits and a queue for admitted work, with a temporary cooldown after repeated provider failures.
- Configure a tested fallback route with independent model/provider capacity where useful. Do not implement account rotation as a substitute for quota management.
- Count wire requests, repairs, fallback calls, tokens and reported cost. Preserve provider request IDs and returned model IDs.
- Save completed stage results and resume only failed work when the input/model/schema version still matches.
- Store a diagnostic record for each stage and expose a sanitized report to the project owner.

### Diagnostic record

`run_id`, project/round ID, input-version hash, stage, status (`success`, `degraded`, `failed`, `skipped`), provider/model, secret alias, start/end, queue wait, HTTP attempt count, repair count, fallback count, token usage, reported cost, cache hit, provider request ID, error category and evidence summary. Do not store API keys or duplicate complete prompts in diagnostics. Apply retention and access rules to these records.

### Acceptance and evidence

- Injected 401/403/quota/429/5xx/timeouts each produce the expected recovery behavior and message.
- A reported attempt count matches actual mock-server HTTP requests.
- Retry and fallback work cannot exceed the agreed total stage budget or job deadline.
- Duplicate clicks create one logical job and no duplicate finalized version.
- A provider outage leaves an understandable state with saved input and a usable recovery path.

## WO-04 — Establish a shared scope with source evidence

### Work

- Add a versioned scope schema with stable requirement IDs, source references, actors, priority, MVP decision, acceptance criteria, dependencies and unresolved decisions.
- Distinguish requested, inferred, suggested, accepted and excluded items. New external suggestions require a clear user decision before entering committed scope.
- Link source evidence to the relevant input or answer version. Support exact spans when available and label paraphrased evidence accurately.
- Detect incompatible constraints, such as two deadlines, conflicting roles or integrations excluded in another sentence.
- Preserve later corrections and exclusions instead of accumulating contradictory instructions.
- Add compatible storage migrations and adapters for older projects.

### Acceptance and evidence

- Every committed requirement has source evidence or an explicit user acceptance record.
- Answers change the corresponding requirement without creating unexplained duplicates.
- Explicit exclusions are preserved across rounds and generation.
- Older projects still load, edit and export after migration.

## WO-05 — Repair GitHub relevance and evidence handling

### Work

- Build searches from domain-specific workflows and distinctive integrations, then broaden only when needed. Treat generic auth/dashboard terms as weak signals.
- Reduce popularity bias and avoid discarding relevant candidates before relevance ranking.
- Score a bounded candidate set on domain, workflow overlap, requirements, integration fit and repository condition. Record which criteria were actually inspected.
- Distinguish search-only, folder-inspected, README-inspected and deeply assessed matches. Reject unrelated matches from corroboration.
- Require specific relevant evidence before marking a module corroborated; a generic folder name alone is insufficient.
- Keep public repository suggestions separate from client requirements.
- Cache raw repository content separately from project-specific scoring. Include scope/model/scoring versions in relevance cache keys; do not cache degraded matches as healthy for a day.
- Respect rate-limit resets and report partial availability. Permit initial scope and clarification to proceed if external enrichment is unavailable.

### Likely files

`lib/github/search.ts`, `lib/github/client.ts`, `lib/pipeline/github-enrich.ts`, `lib/pipeline/merge.ts`, `lib/scoring/modules.ts`, `lib/schemas/github.ts`.

### Acceptance and evidence

- On at least 15 reviewed prompts, average precision@5 is at least 0.8: reviewers judge approximately four of the first five recommendations useful under the documented relevance rubric.
- When fewer relevant repositories exist or are recovered, show fewer results and report availability; never pad with unrelated links. Report result coverage separately.
- Every displayed relevance explanation is supported by retrieved material.
- Unscored/zero-relevance folder matches cannot increase a validation badge.
- Two different scopes sharing search terms cannot inherit each other's similarity scores.
- Adding a valid token allows a previously degraded run to refresh without waiting a full day.

## WO-06 — Make client and engineer views agree

### Work

- Generate both views from the same approved scope version and requirement IDs.
- Preserve identical modules, inclusion decisions, roles, agreed constraints and unresolved items across views.
- Let the model write audience-specific explanations while server rules enforce shared facts.
- Validate references between modules, APIs, tables, tests and milestones. Mark proposed engineering choices as proposals when the client did not specify them.
- Check generated output against the source scope before publishing a completed version; retain a partial/draft state for unresolved validation failures.
- Carry the same IDs and scope version through edits, version diffs, shares and exports.

### Acceptance and evidence

- Shared requirement IDs and inclusion/exclusion states agree in 100% of generated outputs by deterministic validation.
- No silent omission or extra committed feature passes the output validator on reviewed cases.
- Client prose and engineering details remain readable, and generated API/table suggestions are distinguishable from confirmed client facts.
- Both views, saved versions and exported documents preserve the same scope decisions.

## WO-07 — Replace ambiguous confidence with measured readiness

### Work

- Show separate indicators for requirement completeness, unresolved critical decisions and external evidence coverage.
- Retain a documented readiness rule for moving through the workflow, with explicit blocker conditions and a visible explanation.
- Remove any interpretation that public repository popularity verifies requirements or that agreement with model self-scoring establishes correctness.
- Record which input/schema/model/scoring versions produced each result so historical scores remain interpretable.
- Use reviewed cases to study repeatability and false-ready decisions before selecting weights and thresholds.

### Acceptance and evidence

- Scores cannot rise solely because unrelated repositories or unaccepted suggestions were added.
- Missing essential goal/features or unresolved critical contradictions cannot receive a ready-to-commit state.
- Three runs of the same reviewed case have readiness-score standard deviation at most 5 points and at least 95% agreement on ready/clarify decisions across the benchmark.
- Zero false-ready decisions on the benchmark's explicit critical-blocker cases; publish sample size.
- If a probability is ever shown, define the predicted event and validate its calibration on held-out data first. Otherwise use readiness/completeness wording.

## WO-08 — Improve estimates and risk analysis without false precision

### Work

- Base estimates on accepted MVP scope, team availability, integration uncertainty, dependencies, testing, review and deployment work.
- Make team-size defaults and unstated assumptions visible. Avoid treating story points as universally comparable across teams.
- Check deadline/budget feasibility and show scope reduction options with their consequences.
- Add explicit risk coverage for tenant isolation, external integrations, data handling, operational load and conflicting constraints where applicable.
- Extend the existing actuals/calibration workflow with data-quality checks and sample-size labels.
- Keep heuristic ranges labelled as heuristic until observed outcomes support a statistical interpretation.

### Acceptance and evidence

- The listed effort basis sums exactly to totals and responds consistently to accepted scope/team changes.
- Excluded work cannot remain in committed effort totals; dependencies and delivery overhead are visible.
- Every important risk links to a requirement, missing decision or inspected evidence.
- Test scenario arithmetic using fixtures, but keep those fixtures separate from real-world accuracy evidence.
- Report estimated versus actual outcomes for genuine completed projects. Use at least 10 comparable records for an initial descriptive baseline and continue collecting data; this is not enough by itself to claim a calibrated 80% or 95% interval.
- An estimate-accuracy rating above 8.5 remains pending until real outcomes justify it. Honest uncertainty can improve usability immediately, but cannot manufacture historical accuracy.

## WO-09 — Improve usability, accessibility and product fit

### Work

- Add a guided first workflow: brief, extracted scope review, focused questions, MVP decisions, then documents.
- Explain what needs attention and why; allow useful partial results to be read while other stages continue.
- Show stage status, elapsed time, retry/cooldown state and service degradation in ordinary language.
- Add keyboard-complete navigation, focus management, readable contrast, responsive layouts and reduced-motion behavior.
- Use short transitions and restrained progress animation; do not show invented completion percentages or guaranteed finish times.
- Make changes, assumptions, exclusions and evidence easy to inspect. Validate document downloads on desktop and a physical phone.
- Conduct at least five observed sessions with the target audience and record corrections and completion times.

### Acceptance and evidence

- At least 90% completion of the agreed core task across 10 observed test attempts, with no critical usability blocker; record the small sample limitation.
- Core actions work by keyboard and at phone widths, 200% zoom and reduced-motion settings.
- Automated accessibility checks have no serious/critical findings, supported by manual keyboard and screen-reader smoke checks.
- Compare time and editing effort with the user's current manual/general-chat workflow. Product-fit rating depends on this observed benefit.

## WO-10 — Verify security and data lifecycle

### Work

- Keep credentials server-side; document rotation, least access, environment separation and provider privacy settings.
- Test owner/workspace permissions, cross-account access, share expiry/revocation, export authorization and signed queue delivery.
- Check input/file size limits and hostile requirement/README text against the new evidence workflow.
- Fix the authenticated retention endpoint to match the deployed scheduler's HTTP method and test the scheduled path.
- Define precisely what retention deletes across raw input, answers, evidence, versions, diagnostic records, exports and browser drafts.
- Add a complete project deletion path where required by the documented behavior; do not equate clearing raw input with full erasure.
- Review dependency findings and establish backup/restore handling for sensitive test data.

### Acceptance and evidence

- No open high/critical findings in the defined security review and production dependency audit.
- All authorization negative tests pass; invalid job signatures and expired/revoked shares fail.
- No credential or private cross-project content appears in diagnostics or another user's output.
- Retention/deletion expectations are verified on disposable projects through the deployed invocation path.
- Backups, restoration, data retention and remaining moderate findings are documented.

## WO-11 — Prove staging reliability and performance

### Work

- Configure dedicated staging Postgres, shared Redis, durable job delivery and the chosen authentication method.
- Apply migrations to staging, verify recovery/backup procedures and maintain a rollback plan.
- Add job-stage checkpoints, bounded replay and visible failed-job handling where the current implementation lacks them.
- Test duplicate delivery, provider failures, worker termination, database/Redis outages and queue retries.
- Add a protected readiness dashboard and retain liveness as a cheap server-only check.
- Use request-based and token-based budgets, admission control and per-provider limits instead of sending unlimited concurrent work.

### Proposed performance acceptance

Agree and freeze provider/model, prompt set, region, token limits, concurrency and usage budget before measurement. Record cold-start behavior separately.

- At least 30 warm live scenarios, including complete and incomplete briefs; publish failures and denominators.
- At least 95% successful completion in that bounded staging run, with actionable recovery for the rest. This is an initial acceptance test, not a production SLA.
- Warm ordinary API response p95 below 2 seconds; exclude intentionally long SSE connections and separately report queue-to-result latency.
- Initial analysis p95 below 45 seconds and complete rich-brief output p95 below 90 seconds under the agreed baseline. These are proposed targets, not current claims; a free provider may fail them even with correct code.
- At five concurrent users, the system respects configured provider limits, bounds admitted work and reports queue waiting clearly. Publish a capacity curve rather than inferring scale from one run.
- Recover a deliberately interrupted job without losing accepted input or duplicating a finalized version.

## WO-12 — Evaluate independently and decide release readiness

### Work

- Finish human review of 30 existing cases and evaluate on at least 20 additional unseen cases; retain case definitions and disagreements.
- Run repeated extraction checks and a smaller representative full-document benchmark within an explicit quota/cost budget.
- Measure module precision and recall, source-grounded requirement preservation, unsupported committed additions, critical contradictions, GitHub usefulness, readiness decisions, latency and recovery.
- Have an independent reviewer compare client/engineer outputs with expected scope and original evidence.
- Produce per-case and per-stage diagnostic reports, a failure inventory, model/configuration versions and an updated scorecard.
- Run typecheck, lint, format checks, unit/integration tests, isolated browser tests, build and production audit on the release candidate.

### Proposed quality gates

- Parameter-state exact agreement at least 90% and domain-family accuracy at least 95% on reviewed/held-out cases, with per-domain results.
- Must-have module recall at least 95% and committed-module precision at least 95% under the frozen rubric.
- No critical unsupported commitment or critical cross-view contradiction in the release sample; disclose sample size rather than claiming universal absence.
- All shared-fact invariants are enforced for every published document by server validation.
- GitHub relevance, readiness, performance, recovery, security and usability gates from earlier orders pass.
- No unresolved critical/high defect in the release scope. Moderate defects have an owner, impact statement and next action.
- Every dimension receives an evidence-backed re-rating. Failed, unmeasured or historically uncalibrated areas stay below the target.

## Evidence required for a 9/10 assessment

| Review factor         | Evidence required                                                                                      | Work orders    |
| --------------------- | ------------------------------------------------------------------------------------------------------ | -------------- |
| Problem/usefulness    | Reviewed target workflow; observed reduction in scoping time or corrections; user acceptance           | 00, 09, 12     |
| Architecture          | Versioned shared scope; compatible migrations; bounded jobs; recovery and consistency invariants       | 03, 04, 06, 11 |
| AI correctness        | Independent reviewed/holdout results; traceability; semantic and shared-fact validation                | 04, 06, 12     |
| GitHub matching       | Relevant reviewed top results; inspectable evidence; correct cache behavior and graceful degradation   | 02, 05, 12     |
| Confidence/readiness  | Understandable components; no false-ready critical cases; repeatability and held-out results           | 07, 12         |
| Testing               | Isolated automated network; passing browser/core suites; negative and recovery scenarios; CI evidence  | 01, 12         |
| Security              | Verified access boundaries, credential handling, deletion and retention; no high/critical open finding | 02, 10, 12     |
| Performance           | Published staging p50/p95, wire-request/cost counts, load curve and total-stage deadlines              | 03, 11, 12     |
| UX/accessibility      | Observed task completion; physical-device checks; keyboard/contrast/reduced-motion checks              | 09, 12         |
| Deployment/operations | Shared staging infrastructure; signed queue; backup restore; replay/rollback and readiness monitoring  | 10, 11, 12     |
| Estimates/risks       | Inspectable assumptions and risk links; actual completed-project outcomes supporting accuracy claims   | 08, 12         |

## Schedule and checkpoints

For one full-time developer, budget roughly 5–8 weeks of implementation and verification. This is a planning range, not a delivery commitment. Historical estimate calibration and user validation may continue beyond it. A second reviewer helps particularly with labels, evidence judgments and usability; those judgments should not all come from the implementation author.

1. Foundation checkpoint: WO-00 through WO-03. Tests are isolated; services work; failures and spending are visible and bounded.
2. Scope correctness checkpoint: WO-04 through WO-07. Both views agree and GitHub evidence has honest status.
3. Delivery quality checkpoint: WO-08 through WO-10. Estimates are transparent, users can complete the workflow and data handling is verified.
4. Release checkpoint: WO-11 and WO-12. Staging results and independent quality evidence determine the revised ratings.

Stop adding features when a checkpoint fails. Resolve the failed gate and rerun the relevant evidence before proceeding to release.

## What the user must supply

- Fresh provider credentials entered locally, a public-repository GitHub token and a live-test usage budget. Avoid sharing credentials in chat.
- A dedicated staging database, Redis and QStash configuration when deployment validation begins; authentication credentials and two test accounts for cross-user checks.
- A mentor/domain reviewer for labels and three to five representative users for observed testing.
- Genuine completed-project estimates and actual results for any credible estimate-accuracy rating.
- An initial audience decision and acceptance of the written quality rubric. Small agency web-app MVP scoping is the default proposal until changed.

## First execution batch

Start with WO-00 and WO-01. The concrete first implementation deliverable is a browser suite that cannot call the real provider, cannot reuse an unrelated server, and passes its current scenarios against deterministic AI/GitHub fixtures. Then complete WO-02 credential/readiness checks before spending quota on a new live baseline.

## Per-order completion report

For each work order record: scope delivered, changed files, migration impact, tests and observed results, live-call count/cost if applicable, failure cases, unresolved issues, evidence location and the next dependency unlocked. Status must be one of planned, in progress, awaiting user input, awaiting real-world evidence, failed verification or verified complete.
