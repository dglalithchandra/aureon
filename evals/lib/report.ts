import { SCOPING } from "@/lib/config/scoping";
import type { Prices, TokenTotals } from "./metrics";

/**
 * The shape of evals/reports/<date>.json and the Markdown beside it. The JSON
 * is the record — every later report is compared against it — so it keeps the
 * per-run detail, not only the averages.
 */

export interface CaseSummary {
  id: string;
  tags: string[];
  labelStatus: "draft" | "reviewed";
  runs: number;
  errors: string[];
  /** Share of the 9 parameters matched exactly, averaged over the runs. */
  paramExact: number;
  paramWithinOne: number;
  /** Share of the 9 parameters where every run said the same thing. */
  paramSelfAgreement: number;
  domainExpected: string | null;
  domainObserved: string[];
  /** null when the case has no expected domain (a blocker with no product). */
  domainAccuracy: number | null;
  moduleRecall: number;
  missingModules: string[];
  scores: number[];
  scoreSd: number;
  decisions: string[];
  decisionAgreement: boolean;
  blockerExpected: boolean;
  blockerAccuracy: number;
  leaked: string[];
  latencyMs: number[];
}

export interface ParameterSummary {
  id: string;
  name: string;
  exact: number;
  withinOne: number;
  selfAgreement: number;
  /** "expected → observed" counts, worst first, for the states that missed. */
  confusions: Array<{ from: string; to: string; count: number }>;
}

export interface TargetResult {
  name: string;
  target: string;
  actual: string;
  pass: boolean;
}

export interface EvalReport {
  generatedAt: string;
  mock: boolean;
  provider: string;
  model: string;
  commit: string;
  runsPerCase: number;
  caseCount: number;
  callCount: number;
  errorCount: number;
  labels: { draft: number; reviewed: number };
  totals: {
    paramExact: number;
    paramWithinOne: number;
    paramSelfAgreement: number;
    domainAccuracy: number;
    domainScoredCases: number;
    moduleRecall: number;
    meanScoreSd: number;
    maxScoreSd: number;
    decisionAgreement: number;
    blockerAccuracy: number;
    injectionCases: number;
    injectionLeaks: number;
  };
  latency: { p50: number; p95: number; mean: number };
  tokens: TokenTotals;
  cost: { usd: number; prices: Prices };
  targets: TargetResult[];
  parameters: ParameterSummary[];
  cases: CaseSummary[];
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
const ms = (value: number): string => `${Math.round(value)} ms`;

function table(header: string[], rows: string[][]): string {
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ];
  return lines.join("\n");
}

/** The Markdown written next to the JSON. Written for a human, in order. */
export function renderMarkdown(report: EvalReport): string {
  const t = report.totals;
  const draftWarning =
    report.labels.draft > 0
      ? `> **${report.labels.draft} of ${report.caseCount} cases still carry draft labels.** ` +
        `Until the owner has reviewed them, every accuracy number below measures agreement ` +
        `with a guess, not with ground truth.\n\n`
      : "";
  const mockWarning = report.mock
    ? `> **Mock run.** The model was the in-process stand-in from tests/mocks/mock-anthropic.ts, ` +
      `which answers every input with the same fixture. This run proves the harness works; ` +
      `its accuracy numbers mean nothing.\n\n`
    : "";

  const parts: string[] = [];

  parts.push(`# Evaluation report — ${report.generatedAt.slice(0, 10)}

${mockWarning}${draftWarning}${report.caseCount} cases × ${report.runsPerCase} run${report.runsPerCase === 1 ? "" : "s"} = ${report.callCount} extraction calls${report.errorCount > 0 ? `, ${report.errorCount} of which failed` : ""}.
Provider \`${report.provider}\`, model \`${report.model}\`, commit \`${report.commit}\`, generated ${report.generatedAt}.`);

  parts.push(`## Targets

${table(
  ["Metric", "Target", "This run", ""],
  report.targets.map((target) => [
    target.name,
    target.target,
    target.actual,
    target.pass ? "pass" : "MISS",
  ]),
)}`);

  parts.push(`## Headline

${table(
  ["Metric", "Value", "What it means"],
  [
    [
      "Parameter state, exact",
      pct(t.paramExact),
      "the extraction's state equals the label, over all 9 parameters × cases × runs",
    ],
    [
      "Parameter state, within one level",
      pct(t.paramWithinOne),
      "one step apart on MISSING → PARTIAL_THIN → PARTIAL_DEEP → PRESENT",
    ],
    [
      "Parameter self-agreement",
      pct(t.paramSelfAgreement),
      "every run of the same case gave the same state (independent of the label)",
    ],
    [
      "Domain accuracy",
      pct(t.domainAccuracy),
      `same domain family as the label, over the ${t.domainScoredCases} cases that have one`,
    ],
    [
      "Must-have module recall",
      pct(t.moduleRecall),
      "labelled modules the extraction proposed, synonyms accepted",
    ],
    ["Blocker accuracy", pct(t.blockerAccuracy), "the blocker flag matched the label"],
    [
      "Score standard deviation",
      `${t.meanScoreSd.toFixed(2)} points (worst case ${t.maxScoreSd.toFixed(2)})`,
      "spread of the computed confidence across identical runs",
    ],
    [
      "Ready/ask agreement",
      pct(t.decisionAgreement),
      `every run of a case landed on the same side of the exit threshold (${SCOPING.confidenceThreshold})`,
    ],
    [
      "Injection resistance",
      `${t.injectionCases - t.injectionLeaks}/${t.injectionCases}`,
      "injection cases where no forbidden string reached the output",
    ],
  ],
)}`);

  parts.push(`## Cost and latency

${table(
  [
    "Tokens in",
    "Tokens out",
    "Cache read",
    "Cache write",
    "Estimated cost",
    "p50",
    "p95",
  ],
  [
    [
      report.tokens.input.toLocaleString("en-US"),
      report.tokens.output.toLocaleString("en-US"),
      report.tokens.cacheRead.toLocaleString("en-US"),
      report.tokens.cacheWrite.toLocaleString("en-US"),
      `$${report.cost.usd.toFixed(2)}`,
      ms(report.latency.p50),
      ms(report.latency.p95),
    ],
  ],
)}

Prices used, US dollars per million tokens: input ${report.cost.prices.input}, output ${report.cost.prices.output}, cache write ${report.cost.prices.cacheWrite}, cache read ${report.cost.prices.cacheRead}. A retried call only reports its final attempt, so a run with repairs cost slightly more than this.`);

  parts.push(`## Per parameter

${table(
  [
    "Parameter",
    "Exact",
    "Within one",
    "Self-agreement",
    "Most common miss (label → run)",
  ],
  report.parameters.map((p) => [
    `${p.id} ${p.name}`,
    pct(p.exact),
    pct(p.withinOne),
    pct(p.selfAgreement),
    p.confusions[0]
      ? `${p.confusions[0].from} → ${p.confusions[0].to} (${p.confusions[0].count}×)`
      : "—",
  ]),
)}`);

  parts.push(`## Per case

${table(
  ["Case", "Tags", "Exact", "±1", "Domain", "Recall", "Score (sd)", "Decision", "p50"],
  report.cases.map((c) => [
    c.id,
    c.tags.join(", "),
    pct(c.paramExact),
    pct(c.paramWithinOne),
    c.domainAccuracy === null ? "n/a" : pct(c.domainAccuracy),
    pct(c.moduleRecall),
    `${c.scores.length > 0 ? (c.scores.reduce((s, v) => s + v, 0) / c.scores.length).toFixed(0) : "—"} (${c.scoreSd.toFixed(1)})`,
    c.decisionAgreement ? (c.decisions[0] ?? "—") : `split: ${c.decisions.join("/")}`,
    c.latencyMs.length > 0
      ? ms(
          [...c.latencyMs].sort((a, b) => a - b)[Math.floor(c.latencyMs.length / 2)] ?? 0,
        )
      : "—",
  ]),
)}`);

  const problems = report.cases.filter(
    (c) => c.errors.length > 0 || c.leaked.length > 0 || c.missingModules.length > 0,
  );
  if (problems.length > 0) {
    parts.push(`## What to look at

${problems
  .map((c) => {
    const notes: string[] = [];
    if (c.errors.length > 0) notes.push(`errors: ${c.errors.join("; ")}`);
    if (c.leaked.length > 0) {
      notes.push(`**injection leaked: ${c.leaked.join(", ")}**`);
    }
    if (c.missingModules.length > 0) {
      notes.push(`modules never proposed: ${c.missingModules.join(", ")}`);
    }
    return `- \`${c.id}\` — ${notes.join(" · ")}`;
  })
  .join("\n")}`);
  }

  parts.push(`## How to read this

- The labels are hand-written in \`evals/cases/*.json\`. Where the extraction and the label disagree, the label is as likely to be wrong as the model; the \`notes\` field of each case says which calls were close.
- Domain is compared by family, so "B2B SaaS" and "SaaS platform" both match a SaaS label. Cases whose label has no domain (the blocker cases) are excluded and counted above.
- The score is computed by \`lib/scoring/confidence.ts\`, not asked of the model (ARCH-01), so its spread across runs comes only from the parameter states and the clarity read.
- Re-run with \`npx tsx evals/run.ts\`. The harness itself is checked by \`npm run evals:mock\`, which never calls a paid API.`);

  return `${parts.join("\n\n")}\n`;
}
