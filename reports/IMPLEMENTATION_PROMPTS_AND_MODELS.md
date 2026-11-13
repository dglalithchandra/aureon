# Aureon implementation prompts and model choices

Date: 2026-11-06

Use these prompts one work order at a time, in the order shown in
`reports/IMPROVEMENT_WORK_ORDER.md`. Do not ask one agent to implement the whole plan in a
single turn: the acceptance evidence from one order is an input to the next.

## Model choices

### Model for implementing the repository in Codex

Budget-first routing:

- Default: **GPT-6 Luna, medium reasoning** for inspection, test execution, documentation and
  narrow fixes with clear acceptance criteria.
- Implementation escalation: **GPT-6.1 Terra, medium or high reasoning** for multi-file changes,
  debugging and normal feature implementation.
- Rare review escalation: **GPT-6.1 Sol, high reasoning** only for difficult architecture,
  security boundaries, scoring methodology or a final release review.
- Do not use Astra unless Terra and Sol have both failed to resolve a genuinely difficult issue.

Finish one work order before starting another, and reuse its written evidence instead of asking a
new expensive model to rediscover the repository. Mocked tests should be the default; live provider
checks should be small and explicitly requested.

### Models used by Aureon at runtime

Recommended initial paid configuration through OpenRouter:

```dotenv
LLM_PROVIDER=openrouter
LLM_MAIN_PROVIDER=openrouter
LLM_FAST_PROVIDER=openrouter
OPENROUTER_MODEL=openai/gpt-6.1-terra
OPENROUTER_FAST_MODEL=openai/gpt-6-luna
```

Cost-sensitive configuration:

```dotenv
OPENROUTER_MODEL=openai/gpt-6-luna
OPENROUTER_FAST_MODEL=openai/gpt-6-luna
```

Free smoke-test configuration (not suitable for reliability or quality scoring):

```dotenv
OPENROUTER_MODEL=google/gemma-4-31b-it:free
OPENROUTER_FAST_MODEL=google/gemma-4-26b-a4b-it:free
```

The paid recommendation is based on the OpenRouter model catalog available on 2026-11-06:
the selected models advertise tool support and a 1,050,000-token context. Model availability
and price can change, so pin the chosen IDs in configuration and re-run the model capability
probe before release.

Use **one OpenRouter key initially**. A second provider/key is useful for a real outage fallback.
Do not distribute normal traffic across keys from multiple accounts to evade provider rate limits.
Control load with concurrency limits, timeouts, retry budgets, caching and model routing. Never
paste keys into prompts, source code, reports or logs.

## Common operating block

Paste this block before every work-order prompt:

```text
Work in C:\Users\D Lalith Chandra\Desktop\scopeai.

Read AGENTS.md and reports/IMPROVEMENT_WORK_ORDER.md completely. Before changing Next.js code,
read the relevant guide under node_modules/next/dist/docs because this repository's Next.js
version has breaking changes. Inspect the current git status and preserve all existing user work;
do not reset, discard, overwrite or reformat unrelated changes. Do not commit or push.

Implement only the named work order and all of its acceptance criteria. Start by reproducing or
measuring the current behavior. Add or update automated tests before claiming success. Never put
real secrets in code, tests, fixtures, reports, terminal output or screenshots. Mock external LLM
and GitHub services in deterministic tests unless the work order explicitly calls for a separately
labelled live probe.

When finished, run the narrow tests first, then the relevant full test/typecheck/lint/build gates.
Report: files changed, design decisions, commands and exact results, acceptance criteria passed or
failed, remaining risks, and the next work order. Distinguish mocked, local, live and unverified
evidence. Do not claim completion if any required gate is unverified.
```

## WO-00 prompt — product contract and baseline

**Model:** GPT-6.1 Terra high; use Sol only for a short final architecture review.

```text
Execute WO-00 only. Inventory the actual current product flow, public claims, generated artifacts,
data retention behavior, external dependencies and evaluation status. Create a concise product
contract defining intended users, supported input, outputs, non-goals and the meaning of every
score. Create a reproducible baseline report with current tests, build, latency, external-service
readiness and known limitations. Correct documentation claims that exceed evidence, but do not
redesign or implement later work orders. Satisfy every WO-00 acceptance item with file/command
evidence.
```

## WO-01 prompt — isolated and truthful tests

**Model:** GPT-6 Luna medium; escalate only a difficult failure to Terra.

```text
Execute WO-01 only. Make unit, integration and Playwright tests hermetic. Repair scripts/e2e-server.ts
so every provider/model/key variable is explicitly overridden for tests, and repair Playwright
configuration so it cannot silently attach to a live developer server. Use deterministic local
fake LLM and GitHub responses. Add a tripwire test that fails if an isolated suite makes external
network calls or reads real credentials. Prove an isolated end-to-end run succeeds with all real
provider keys absent. Also retain a separate, opt-in live smoke command with unmistakable output.
```

## WO-02 prompt — configuration, credentials and readiness

**Model:** GPT-6.1 Terra medium.

```text
Execute WO-02 only. Define and validate the environment-variable contract for LLM routes, GitHub,
database and scheduled jobs. Add safe startup/readiness diagnostics that show configured/missing/
invalid without exposing secret values. Separate liveness from readiness and expose dependency
status in an operator-safe way. Correct the retention cron method mismatch and test both route and
scheduler behavior. Update .env.example and setup documentation. Never read back or print .env.local.
```

## WO-03 prompt — bounded AI gateway and diagnostics

**Model:** GPT-6.1 Terra high; use Sol only if the gateway design remains unresolved.

```text
Execute WO-03 only. Centralize all LLM calls behind one observable gateway. Add explicit per-call,
per-stage and end-to-end time budgets; bounded retries with jitter; concurrency limits; cancellation;
and a circuit breaker/fallback policy. Record sanitized stage, provider, model, attempt, latency,
token usage where available, result class and error class. Count lower-level HTTP attempts truthfully.
Return partial/degraded results rather than hanging when policy allows. Add deterministic tests for
timeout, retry, cancellation, 429, 5xx, malformed tool output, fallback and redaction. Target a
bounded normal run instead of the previously observed multi-minute behavior.
```

## WO-04 prompt — canonical evidence-backed scope model

**Model:** GPT-6.1 Terra high; optionally use Sol for one schema review after implementation.

```text
Execute WO-04 only. Introduce one versioned canonical scope model from which client and engineering
artifacts are derived. Every requirement, assumption, clarification, risk, recommendation and module
must have a stable ID and provenance linking it to user text, file evidence, GitHub evidence or an
explicit inference. Define schema validation and migration/version behavior. Prevent unsupported
claims from silently becoming facts. Add contract, provenance and round-trip tests, including
contradictory and incomplete inputs.
```

## WO-05 prompt — GitHub retrieval quality

**Model:** GPT-6.1 Terra high.

```text
Execute WO-05 only. Replace broad star-biased GitHub retrieval with intent- and stack-aware query
generation, authenticated quota-aware requests, diverse candidate collection, evidence extraction
and explicit reranking. Make cache keys include every input that affects scoring; never persist
degraded/failed results as healthy results. Do not label a module github_validated unless repository
content supplies positive evidence. Add a fixed relevance benchmark with relevant, irrelevant,
archived, empty, forked, license-mismatched and rate-limited cases. Report Recall@K, Precision@K,
nDCG/MRR and evidence coverage; do not claim 100% accuracy.
```

## WO-06 prompt — consistent client and engineer views

**Model:** GPT-6.1 Terra medium.

```text
Execute WO-06 only. Generate both views from the canonical WO-04 scope model. Add a traceability
matrix covering requirements, modules, milestones, risks, assumptions, estimates and evidence.
Ensure differences are purposeful presentation differences, not semantic contradictions. Detect
missing IDs, orphan items and conflicting values automatically. Add golden and invariant tests for
multiple representative scopes and make traceability inspectable in the UI/report.
```

## WO-07 prompt — calibrated readiness instead of false confidence

**Model:** GPT-6.1 Terra high; use Sol only for the final metric-design review.

```text
Execute WO-07 only. Rename the current heuristic so it is not presented as statistical confidence.
Define a transparent readiness score from measurable completeness, evidence coverage, contradiction,
unresolved-decision and validation components. Show component scores, missing evidence and concrete
actions that would improve readiness. Create labelled evaluation cases and calibration/error metrics;
do not tune on the final holdout. Add monotonicity and adversarial tests so fabricated detail cannot
raise the score merely by adding text.
```

## WO-08 prompt — effort and risk without false precision

**Model:** GPT-6.1 Terra medium.

```text
Execute WO-08 only. Replace single-point effort claims with documented ranges, assumptions,
dependencies and uncertainty drivers. Separate deterministic calculations from model-generated
judgment. Make risks traceable to requirements/evidence and include likelihood, impact, owner,
mitigation and trigger. Add boundary, consistency and sensitivity tests. Ensure client and engineer
views use the same underlying values and clearly identify estimates that have not been calibrated
against historical delivery data.
```

## WO-09 prompt — UX, accessibility and progress truthfulness

**Model:** GPT-6.1 Terra medium.

```text
Execute WO-09 only. Improve the chat/pipeline/result experience without hiding failure states.
Replace decorative progress with state driven by real stage events, elapsed time and bounded timeout
expectations. Add cancel/retry/recovery, partial-result explanations and useful error messages.
Repair contrast, focus order, keyboard use, reduced motion, responsive layout and screen-reader
announcements. Keep animation lightweight and never block interaction. Add component and Playwright
tests plus automated accessibility checks for success, degraded, failure and cancellation paths.
```

## WO-10 prompt — security and data lifecycle

**Model:** GPT-6.1 Terra high; use Sol for one final security review.

```text
Execute WO-10 only. Threat-model input ingestion, file parsing, prompt/tool boundaries, SSRF, GitHub
content, session access, logs, database records, scheduled deletion and generated exports. Verify
authorization and tenant/session isolation. Redact credentials and sensitive content from errors and
diagnostics. Add file type/size/content safeguards and prompt-injection resistance at trust boundaries.
Prove retention deletion with read-back evidence. Run dependency and secret scanning and add focused
abuse tests. Do not expose or rotate credentials automatically; report any required user action.
```

## WO-11 prompt — staging reliability and performance

**Model:** GPT-6.1 Terra high.

```text
Execute WO-11 only. Build a repeatable staging diagnostic and load test for concurrent submissions,
provider throttling, GitHub exhaustion, cancellation, process restart and partial dependency outage.
Measure p50/p95/p99 latency, completion/degradation/failure rates, retry amplification, LLM calls per
run, token/cost estimates and recovery time. Enforce the performance gates documented in the work
order. Add dashboards or structured diagnostic artifacts suitable for comparing runs. Do not mix
mock-load evidence with live-provider capacity claims.
```

## WO-12 prompt — independent evaluation and release decision

**Model:** GPT-6.1 Sol high in a fresh context; this is the one order where the stronger model is justified.

```text
Execute WO-12 only after WO-00 through WO-11 have evidence. Freeze prompts/configuration and a test
version, then evaluate on the untouched holdout. Score extraction, traceability, contradictions,
GitHub relevance, view agreement, readiness calibration, latency, reliability, accessibility,
security and operational readiness using the documented gates. Include failures and confidence
intervals where appropriate. Produce a release decision of GO, CONDITIONAL GO or NO-GO with exact
failed gates and remediation. Do not award 9/10 from test count or subjective appearance.
```

## Best first prompt to run now

Start with the common operating block followed by **WO-01**. The repository already has substantial
automated coverage, but the existing browser test path can inherit live provider configuration.
Until isolation is repaired, later measurements can look successful while consuming real keys and
cannot serve as reliable acceptance evidence.
