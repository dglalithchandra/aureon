/**
 * The evaluation harness: run every case in evals/cases/ through the real
 * extraction N times and write evals/reports/<date>.md and .json.
 *
 *   npx tsx evals/run.ts                    30 cases x 3 runs, the real provider
 *   npx tsx evals/run.ts --runs=1           one run each, a cheaper baseline
 *   npx tsx evals/run.ts --cases=thin,saas  only cases whose id contains these
 *   npx tsx evals/run.ts --dry-run          print the plan and the cost, call nothing
 *   npm run evals:mock                      the mock server, no spend, checks the harness
 *
 * THE DEFAULT MODE SPENDS REAL MONEY. It refuses to start in CI unless
 * --allow-ci is passed, which only .github/workflows/evals.yml does, behind a
 * manual trigger. Credentials come from the environment or .env.local:
 * ANTHROPIC_API_KEY, or OPENROUTER_API_KEY with LLM_PROVIDER=openrouter.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { SCOPING } from "@/lib/config/scoping";
import { computeConfidence } from "@/lib/scoring/confidence";
import type { runExtraction as runExtractionFn } from "@/lib/pipeline/extract";
import type { ExtractionResult } from "@/lib/schemas/extraction";
import { EvalCaseSchema, type EvalCase, type RunResult } from "./lib/types";
import {
  allAgree,
  domainMatches,
  estimateCost,
  leakedStrings,
  mean,
  moduleRecall,
  percentile,
  rate,
  stateDistance,
  stdev,
  type Prices,
  type TokenTotals,
} from "./lib/metrics";
import {
  renderMarkdown,
  type CaseSummary,
  type EvalReport,
  type ParameterSummary,
  type TargetResult,
} from "./lib/report";

const EVALS_DIR = fileURLToPath(new URL("./", import.meta.url));
const CASES_DIR = join(EVALS_DIR, "cases");
const REPORTS_DIR = join(EVALS_DIR, "reports");
const README = join(EVALS_DIR, "..", "README.md");

/* ------------------------------------------------------------------ args */

const argv = process.argv.slice(2);
const flag = (name: string): boolean => argv.includes(`--${name}`);
const value = (name: string): string | undefined =>
  argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const number = (name: string, fallback: number): number => {
  const n = Number(value(name));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const MOCK = flag("mock");
const DRY_RUN = flag("dry-run");
const RUNS = number("runs", MOCK ? 1 : 3);
const CONCURRENCY = Math.min(4, number("concurrency", MOCK ? 4 : 2));
const FILTER = (value("cases") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const OUT_DIR = value("out") ?? (MOCK ? join(tmpdir(), "aureon-evals") : REPORTS_DIR);

/* --------------------------------------------------------------- env */

/** .env.local, the way the other manual scripts read it. */
function loadEnvFile(path: string): void {
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let raw = trimmed.slice(eq + 1).trim();
      if (
        (raw.startsWith('"') && raw.endsWith('"')) ||
        (raw.startsWith("'") && raw.endsWith("'"))
      ) {
        raw = raw.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = raw;
    }
  } catch {
    /* no .env.local is fine: the environment may already carry the key */
  }
}

/* ------------------------------------------------------------- targets */

const TargetsSchema = z.object({
  parameter_exact_accuracy: z.number().min(0).max(1),
  domain_accuracy: z.number().min(0).max(1),
  score_sd: z.number().min(0),
});

function loadTargets(): z.infer<typeof TargetsSchema> {
  const path = join(EVALS_DIR, "targets.json");
  return TargetsSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/* --------------------------------------------------------------- cases */

function loadCases(): EvalCase[] {
  const files = readdirSync(CASES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const cases = files.map((file) => {
    const parsed = EvalCaseSchema.safeParse(
      JSON.parse(readFileSync(join(CASES_DIR, file), "utf8")),
    );
    if (!parsed.success) {
      throw new Error(`${file} is not a valid case: ${parsed.error.message}`);
    }
    return parsed.data;
  });
  if (FILTER.length === 0) return cases;
  return cases.filter((c) => FILTER.some((f) => c.id.includes(f)));
}

/* --------------------------------------------------------------- prices */

/**
 * List prices in US dollars per million tokens, correct for claude-sonnet-4-6
 * when this was written (September 2026). They move; override with
 * EVALS_PRICE_IN / _OUT / _CACHE_WRITE / _CACHE_READ rather than editing this.
 * OpenRouter's free models cost nothing, so that column is zero by default.
 */
function pricesFor(provider: string): Prices {
  if (provider === "mock") return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  const base: Prices =
    provider === "openrouter"
      ? { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }
      : { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 };
  const override = (envName: string, fallback: number): number => {
    const n = Number(process.env[envName]);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    input: override("EVALS_PRICE_IN", base.input),
    output: override("EVALS_PRICE_OUT", base.output),
    cacheWrite: override("EVALS_PRICE_CACHE_WRITE", base.cacheWrite),
    cacheRead: override("EVALS_PRICE_CACHE_READ", base.cacheRead),
  };
}

/* ----------------------------------------------------------- the runner */

type RunExtraction = typeof runExtractionFn;

async function runOne(
  runExtraction: RunExtraction,
  testCase: EvalCase,
  run: number,
): Promise<RunResult> {
  const started = Date.now();
  let usage: RunResult["usage"];
  try {
    const extraction: ExtractionResult = await runExtraction({
      rawText: testCase.text,
      onUsage: (u) => {
        usage = u;
      },
    });
    const score = computeConfidence(extraction).score;
    const blocker = extraction.blocker;
    return {
      caseId: testCase.id,
      run,
      ok: true,
      latencyMs: Date.now() - started,
      usage,
      observed: {
        domain: extraction.domain,
        blocker,
        parameters: Object.fromEntries(extraction.parameters.map((p) => [p.id, p.state])),
        modules: extraction.modules.map((m) => m.name),
        score,
        decision: blocker || score < SCOPING.confidenceThreshold ? "ask" : "ready",
        leaked: leakedStrings(
          testCase.expected.forbidden_strings,
          JSON.stringify(extraction),
        ),
      },
    };
  } catch (err) {
    return {
      caseId: testCase.id,
      run,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - started,
      usage,
    };
  }
}

/** A fixed pool: the provider is happier with a steady two calls than a burst. */
async function runAll(
  runExtraction: RunExtraction,
  cases: EvalCase[],
): Promise<RunResult[]> {
  const queue: Array<{ testCase: EvalCase; run: number }> = [];
  for (const testCase of cases) {
    for (let run = 1; run <= RUNS; run++) queue.push({ testCase, run });
  }
  const results: RunResult[] = [];
  let next = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      const item = queue[index];
      if (!item) return;
      const result = await runOne(runExtraction, item.testCase, item.run);
      results.push(result);
      done++;
      const mark = result.ok ? "ok " : "ERR";
      process.stdout.write(
        `  [${String(done).padStart(3)}/${queue.length}] ${mark} ${item.testCase.id} #${item.run} ${result.latencyMs} ms${result.ok ? "" : ` — ${result.error}`}\n`,
      );
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  return results;
}

/* ------------------------------------------------------------ summarise */

function summariseCase(testCase: EvalCase, results: RunResult[]): CaseSummary {
  const ok = results.filter((r) => r.ok && r.observed).map((r) => r.observed!);
  const expected = testCase.expected;
  const paramIds = SCOPING.parameters.map((p) => p.id);

  const exact: number[] = [];
  const within: number[] = [];
  for (const observed of ok) {
    const marks = paramIds.map((id) => {
      const want = expected.parameters[id]!;
      const got = observed.parameters[id] ?? "";
      return stateDistance(want, got);
    });
    exact.push(rate(marks.map((d) => d === 0)));
    within.push(rate(marks.map((d) => d !== null && d <= 1)));
  }

  const selfAgreement = rate(
    paramIds.map((id) => allAgree(ok.map((o) => o.parameters[id] ?? ""))),
  );

  const recalls = ok.map((o) => moduleRecall(expected.must_have_modules, o.modules));
  const neverProposed = expected.must_have_modules.filter((name) =>
    recalls.every((r) => r.missing.includes(name)),
  );

  const scores = ok.map((o) => o.score);
  const decisions = ok.map((o) => o.decision);

  return {
    id: testCase.id,
    tags: testCase.tags,
    labelStatus: testCase.label_status,
    runs: results.length,
    errors: results.filter((r) => !r.ok).map((r) => r.error ?? "unknown error"),
    paramExact: mean(exact),
    paramWithinOne: mean(within),
    paramSelfAgreement: selfAgreement,
    domainExpected: expected.domain,
    domainObserved: [...new Set(ok.map((o) => o.domain))],
    domainAccuracy:
      expected.domain === null
        ? null
        : rate(ok.map((o) => domainMatches(expected.domain!, o.domain))),
    moduleRecall: mean(recalls.map((r) => r.recall)),
    missingModules: neverProposed,
    scores,
    scoreSd: stdev(scores),
    decisions: [...new Set(decisions)],
    decisionAgreement: allAgree(decisions),
    blockerExpected: expected.blocker,
    blockerAccuracy: rate(ok.map((o) => o.blocker === expected.blocker)),
    leaked: [...new Set(ok.flatMap((o) => o.leaked))],
    latencyMs: results.filter((r) => r.ok).map((r) => r.latencyMs),
  };
}

function summariseParameters(
  cases: EvalCase[],
  byCase: Map<string, RunResult[]>,
): ParameterSummary[] {
  return SCOPING.parameters.map((parameter) => {
    const exact: boolean[] = [];
    const within: boolean[] = [];
    const agree: boolean[] = [];
    const confusion = new Map<string, number>();

    for (const testCase of cases) {
      const observed = (byCase.get(testCase.id) ?? [])
        .filter((r) => r.ok && r.observed)
        .map((r) => r.observed!.parameters[parameter.id] ?? "");
      const want = testCase.expected.parameters[parameter.id]!;
      agree.push(allAgree(observed));
      for (const got of observed) {
        const distance = stateDistance(want, got);
        exact.push(distance === 0);
        within.push(distance !== null && distance <= 1);
        if (distance !== 0) {
          const key = `${want}→${got || "(none)"}`;
          confusion.set(key, (confusion.get(key) ?? 0) + 1);
        }
      }
    }

    return {
      id: parameter.id,
      name: parameter.name,
      exact: rate(exact),
      withinOne: rate(within),
      selfAgreement: rate(agree),
      confusions: [...confusion.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([key, count]) => {
          const [from = "", to = ""] = key.split("→");
          return { from, to, count };
        }),
    };
  });
}

function buildReport(
  cases: EvalCase[],
  results: RunResult[],
  meta: { provider: string; model: string },
): EvalReport {
  const byCase = new Map<string, RunResult[]>();
  for (const result of results) {
    byCase.set(result.caseId, [...(byCase.get(result.caseId) ?? []), result]);
  }

  const summaries = cases.map((c) => summariseCase(c, byCase.get(c.id) ?? []));
  const scored = summaries.filter((s) => s.domainAccuracy !== null);
  const injection = summaries.filter((s) => s.tags.includes("injection"));

  const tokens: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const result of results) {
    if (!result.usage) continue;
    tokens.input += result.usage.inputTokens;
    tokens.output += result.usage.outputTokens;
    tokens.cacheRead += result.usage.cacheReadTokens;
    tokens.cacheWrite += result.usage.cacheCreationTokens;
  }

  const latencies = results.filter((r) => r.ok).map((r) => r.latencyMs);
  const prices = pricesFor(meta.provider);
  const targets = loadTargets();

  const totals = {
    paramExact: mean(summaries.map((s) => s.paramExact)),
    paramWithinOne: mean(summaries.map((s) => s.paramWithinOne)),
    paramSelfAgreement: mean(summaries.map((s) => s.paramSelfAgreement)),
    domainAccuracy: mean(scored.map((s) => s.domainAccuracy!)),
    domainScoredCases: scored.length,
    moduleRecall: mean(summaries.map((s) => s.moduleRecall)),
    meanScoreSd: mean(summaries.map((s) => s.scoreSd)),
    maxScoreSd: Math.max(0, ...summaries.map((s) => s.scoreSd)),
    decisionAgreement: rate(summaries.map((s) => s.decisionAgreement)),
    blockerAccuracy: mean(summaries.map((s) => s.blockerAccuracy)),
    injectionCases: injection.length,
    injectionLeaks: injection.filter((s) => s.leaked.length > 0).length,
  };

  const targetResults: TargetResult[] = [
    {
      name: "Parameter state, exact",
      target: `>= ${(targets.parameter_exact_accuracy * 100).toFixed(0)}%`,
      actual: `${(totals.paramExact * 100).toFixed(1)}%`,
      pass: totals.paramExact >= targets.parameter_exact_accuracy,
    },
    {
      name: "Domain accuracy",
      target: `>= ${(targets.domain_accuracy * 100).toFixed(0)}%`,
      actual: `${(totals.domainAccuracy * 100).toFixed(1)}%`,
      pass: totals.domainAccuracy >= targets.domain_accuracy,
    },
    {
      name: "Score standard deviation",
      target: `<= ${targets.score_sd} points`,
      actual: `${totals.meanScoreSd.toFixed(2)} points`,
      pass: totals.meanScoreSd <= targets.score_sd,
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    mock: MOCK,
    provider: meta.provider,
    model: meta.model,
    commit: gitCommit(),
    runsPerCase: RUNS,
    caseCount: cases.length,
    callCount: results.length,
    errorCount: results.filter((r) => !r.ok).length,
    labels: {
      draft: cases.filter((c) => c.label_status === "draft").length,
      reviewed: cases.filter((c) => c.label_status === "reviewed").length,
    },
    totals,
    latency: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      mean: mean(latencies),
    },
    tokens,
    cost: { usd: estimateCost(tokens, prices), prices },
    targets: targetResults,
    parameters: summariseParameters(cases, byCase),
    cases: summaries,
  };
}

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

/* -------------------------------------------------------------- output */

function writeReport(report: EvalReport): { markdown: string; json: string } {
  mkdirSync(OUT_DIR, { recursive: true });
  const date = report.generatedAt.slice(0, 10);
  let base = join(OUT_DIR, date);
  let suffix = 2;
  while (existsSync(`${base}.md`)) base = join(OUT_DIR, `${date}-${suffix++}`);
  writeFileSync(`${base}.md`, renderMarkdown(report), "utf8");
  writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { markdown: `${base}.md`, json: `${base}.json` };
}

/** Keep the README's "latest report" line pointing at the run just finished. */
function updateReadmeLink(markdownPath: string, report: EvalReport): void {
  const start = "<!-- evals:latest -->";
  const end = "<!-- /evals:latest -->";
  const readme = readFileSync(README, "utf8");
  const from = readme.indexOf(start);
  const to = readme.indexOf(end);
  if (from < 0 || to < 0) {
    console.warn("README has no evals:latest markers; link not updated.");
    return;
  }
  const relative = markdownPath
    .slice(markdownPath.indexOf("evals"))
    .split("\\")
    .join("/");
  const line =
    `Latest report: [${relative}](${relative}) — ${report.caseCount} cases × ${report.runsPerCase} runs on ` +
    `${report.generatedAt.slice(0, 10)}, parameter accuracy ${(report.totals.paramExact * 100).toFixed(1)}%, ` +
    `domain accuracy ${(report.totals.domainAccuracy * 100).toFixed(1)}%, score sd ${report.totals.meanScoreSd.toFixed(2)}.`;
  writeFileSync(
    README,
    `${readme.slice(0, from + start.length)}\n${line}\n${readme.slice(to)}`,
    "utf8",
  );
}

/* --------------------------------------------------------- label sheet */

const SHORT_STATE: Record<string, string> = {
  PRESENT: "P",
  PARTIAL_DEEP: "D",
  PARTIAL_THIN: "T",
  MISSING: "-",
};

/**
 * evals/LABELS.md: every label on one screen, for the review that turns these
 * drafts into ground truth. Regenerate with `npx tsx evals/run.ts --labels`;
 * it calls no model.
 */
function writeLabelSheet(cases: EvalCase[]): string {
  const path = join(EVALS_DIR, "LABELS.md");
  const rows = cases.map((c) => [
    c.id,
    c.tags.join(", "),
    `${c.text.length}`,
    c.expected.domain ?? "—",
    SCOPING.parameters
      .map((p) => SHORT_STATE[c.expected.parameters[p.id]!] ?? "?")
      .join(" "),
    c.expected.blocker ? "yes" : "no",
    c.expected.must_have_modules.join(", ") || "—",
    c.label_status,
  ]);
  const header = [
    "Case",
    "Tags",
    "Chars",
    "Domain",
    "P-01..P-09",
    "Blocker",
    "Must-have modules",
    "Status",
  ];
  const body = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");

  const notes = cases.map((c) => `### ${c.id}\n\n${c.notes}`).join("\n\n");

  writeFileSync(
    path,
    `# Draft labels — review sheet

Generated by \`npx tsx evals/run.ts --labels\`. The case files in
\`evals/cases/\` are the source; this file is only a view of them.

States: **P**resent · partial **D**eep · partial **T**hin · **-** missing, in
order P-01 Goal, P-02 Users, P-03 Features, P-04 Tech, P-05 Integrations,
P-06 Non-functional, P-07 Budget, P-08 Timeline, P-09 Success metrics.

Every row is a draft. Correct anything that is wrong in the case's own JSON
file and set \`"label_status": "reviewed"\` on the cases you have confirmed;
the report counts drafts separately and says so at the top.

${body}

## Why each label says what it says

${notes}
`,
    "utf8",
  );
  return path;
}

/* ---------------------------------------------------------------- main */

async function main(): Promise<void> {
  const cases = loadCases();
  if (cases.length === 0) throw new Error("No cases matched --cases");

  if (flag("labels")) {
    console.log(`${writeLabelSheet(cases)}\n${cases.length} cases, no model called.`);
    return;
  }

  let close: (() => Promise<void>) | null = null;
  let provider = "anthropic";
  let model = "";

  if (MOCK) {
    // The in-process stand-in the test suite uses. It answers every input
    // with the same fixture, so this proves the harness runs, nothing else.
    const { startMockAnthropic } = await import("@/tests/mocks/mock-anthropic");
    const mock = await startMockAnthropic();
    close = () => mock.close();
    process.env.LLM_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-evals-mock-000000000000";
    process.env.ANTHROPIC_BASE_URL = mock.url;
    delete process.env.OPENROUTER_API_KEY;
    provider = "mock";
    model = "tests/mocks/mock-anthropic.ts";
  } else {
    loadEnvFile(join(EVALS_DIR, "..", ".env.local"));
    provider = process.env.LLM_PROVIDER === "openrouter" ? "openrouter" : "anthropic";
    model =
      provider === "openrouter"
        ? (process.env.OPENROUTER_MODEL ?? "openrouter default")
        : "claude-sonnet-4-6";
    const key =
      provider === "openrouter"
        ? process.env.OPENROUTER_API_KEY
        : process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error(
        `No API key for provider "${provider}". Set it in .env.local or the environment, or run npm run evals:mock.`,
      );
    }
    if (process.env.CI && !flag("allow-ci")) {
      throw new Error(
        "Refusing to spend on a real provider in CI. The evals workflow passes --allow-ci; normal CI runs npm run evals:mock.",
      );
    }
  }

  const calls = cases.length * RUNS;
  const prices = pricesFor(provider);
  console.log(
    `${MOCK ? "MOCK" : "REAL"} run · ${cases.length} cases × ${RUNS} runs = ${calls} extraction calls · provider ${provider} (${model}) · concurrency ${CONCURRENCY}`,
  );
  if (!MOCK) {
    // ~9k input tokens for a typical case, ~1.2k out; the long cases are 5x.
    const rough = (calls * 11_000 * prices.input + calls * 1_200 * prices.output) / 1e6;
    console.log(
      `Rough cost before the run: $${rough.toFixed(2)} at $${prices.input}/$${prices.output} per Mtok. Cancel now if that is wrong.`,
    );
  }
  if (DRY_RUN) {
    console.log("--dry-run: stopping before any model call.");
    for (const c of cases) console.log(`  ${c.id.padEnd(30)} ${c.text.length} chars`);
    return;
  }

  const { runExtraction } = await import("@/lib/pipeline/extract");
  const started = Date.now();
  const results = await runAll(runExtraction, cases);
  if (close) await close();

  const report = buildReport(cases, results, { provider, model });
  const written = writeReport(report);
  if (!MOCK) updateReadmeLink(written.markdown, report);

  console.log(
    `\nDone in ${((Date.now() - started) / 1000).toFixed(0)}s. ${report.errorCount} failed call(s).`,
  );
  console.log(
    `Parameter exact ${(report.totals.paramExact * 100).toFixed(1)}% · within one ${(report.totals.paramWithinOne * 100).toFixed(1)}% · ` +
      `domain ${(report.totals.domainAccuracy * 100).toFixed(1)}% · recall ${(report.totals.moduleRecall * 100).toFixed(1)}% · ` +
      `score sd ${report.totals.meanScoreSd.toFixed(2)} · p50 ${Math.round(report.latency.p50)} ms · p95 ${Math.round(report.latency.p95)} ms · ` +
      `$${report.cost.usd.toFixed(2)}`,
  );
  console.log(`${written.markdown}\n${written.json}`);
  if (report.labels.draft > 0 && !MOCK) {
    console.log(
      `\n${report.labels.draft} cases still carry draft labels — these numbers are agreement with a guess until they are reviewed.`,
    );
  }
  if (report.errorCount > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
