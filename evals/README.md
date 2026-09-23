# Evaluation harness

How good is the extraction, and is it getting better or worse? This directory
answers that with 30 labelled briefs and a runner that measures the pipeline's
own `runExtraction` against them.

```
evals/
  cases/*.json      one brief plus its hand-written label
  targets.json      the numbers a run is judged against
  lib/              the case schema, the metrics, the report renderer
  run.ts            the runner
  reports/          <date>.md and <date>.json, one pair per run
  LABELS.md         every label on one screen, for review (generated)
```

## Running it

```bash
npm run evals:mock                      # mock server, no spend, this is what CI runs
npm run evals                           # 30 cases x 3 runs against the REAL provider
npx tsx evals/run.ts --dry-run          # the plan and a cost estimate, no calls
npx tsx evals/run.ts --runs=1           # a cheaper baseline
npx tsx evals/run.ts --cases=thin,long  # only ids containing these
npx tsx evals/run.ts --labels           # regenerate LABELS.md, calls nothing
```

`npm run evals` reads `ANTHROPIC_API_KEY` (or `OPENROUTER_API_KEY` with
`LLM_PROVIDER=openrouter`) from the environment or `.env.local`, exactly like
the scripts in `scripts/`. It refuses to start when `CI` is set unless
`--allow-ci` is passed, which only the manual `evals` workflow does. The unit
tests never touch it: they exercise `evals/lib/` directly and
`npm run evals:mock` drives the whole runner against
`tests/mocks/mock-anthropic.ts`.

Roughly 90 Sonnet calls at three runs each, of which three cases are 20k
characters, so expect a few dollars and 10–20 minutes. `--dry-run` prints the
estimate before you commit to it.

## A case

```jsonc
{
  "id": "saas-01-store-analytics",
  "label_status": "draft", // "reviewed" once a human has confirmed it
  "tags": ["rich"], // thin | blocker | long | indian-language | injection | rich | medium
  "text": "…the brief exactly as a client would paste it…",
  "expected": {
    "domain": "SaaS", // null when no domain is inferable
    "blocker": false, // must equal (P-01 or P-03 is MISSING)
    "parameters": { "P-01": "PRESENT", "…": "…" },
    "must_have_modules": ["Auth", "Dashboard"],
    "forbidden_strings": [], // injection payloads that must never appear
  },
  "notes": "Why these labels, and which calls were close.",
}
```

`tests/unit/evals-cases.test.ts` enforces the shape, the mix (5 thin, 3
blocker, 3 over 20k characters, 3 Indian-language, 2 injection, all nine
domains) and that no label contradicts itself.

## What the report measures

| Metric                            | Meaning                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Parameter state, exact            | the extraction's state equals the label, over 9 parameters × cases × runs                                 |
| Parameter state, within one level | one step apart on MISSING → PARTIAL_THIN → PARTIAL_DEEP → PRESENT                                         |
| Parameter self-agreement          | identical runs of one case gave the same state — measured without the label, so it survives a wrong one   |
| Domain accuracy                   | same family as the label; "B2B SaaS" matches a SaaS label, and cases with no expected domain are excluded |
| Must-have module recall           | labelled modules the extraction proposed, accepting the synonyms in `lib/config/scoping.ts`               |
| Blocker accuracy                  | the blocker flag matched the label                                                                        |
| Score standard deviation          | spread of `computeConfidence()` across identical runs                                                     |
| Ready/ask agreement               | every run of a case landed on the same side of the exit threshold                                         |
| Injection resistance              | no `forbidden_strings` reached the output                                                                 |
| Tokens and cost                   | from the model response; prices are list prices, override with `EVALS_PRICE_IN` and friends               |
| Latency p50 / p95                 | per extraction call, nearest rank                                                                         |

## Targets

`targets.json` starts at parameter accuracy ≥ 80%, domain accuracy ≥ 90% and
score standard deviation ≤ 5 points. These were set before the first real run,
so they are a guess about what good looks like, not a measurement. After the
first baseline:

- If a target is met comfortably, tighten it to just above the baseline —
  a target that cannot fail tells you nothing.
- If parameter accuracy misses, read the per-parameter table before changing
  the number. A parameter that fails in one direction only (say P-05 labelled
  PRESENT, extracted PARTIAL_DEEP) is usually a rubric disagreement, and the
  honest fix is the rubric or the label, not the target.
- The standard deviation target is the one to hold: the score decides whether
  a session keeps asking questions, so a spread of more than a few points is a
  product bug, not a measurement artefact.

Write down why a target moved, in the commit that moves it.

## The labels are drafts

Every case ships with `"label_status": "draft"`. They are one person's reading
of each brief, and the `notes` field names the calls that could reasonably go
the other way — P-05 when a category is named but no provider, P-04 when the
only hint is "app", the domain of a driver app with a dispatch board. Review
`LABELS.md`, correct the case files, and set `"label_status": "reviewed"` on
the ones you have confirmed. Reports count drafts separately and say at the
top that the numbers are agreement with a guess until then.
