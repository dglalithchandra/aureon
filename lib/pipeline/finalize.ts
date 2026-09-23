import "@/lib/server-only";
import { ephemeralCacheControl, PromptModel } from "@/lib/llm/anthropic";
import { callToolWithRepair } from "@/lib/llm/structured";
import {
  CLIENT_VIEW_SYSTEM_PROMPT,
  ENGINEER_VIEW_SYSTEM_PROMPT,
  submitClientViewTool,
  submitEngineerViewTool,
} from "@/lib/llm/prompts/finalize";
import {
  ClientViewSchema,
  EngineerViewSchema,
  type ClientModule,
  type ClientView,
  type ConfidenceBadge,
  type EngineerModuleRow,
  type EngineerView,
  type FinalOutput,
  type GitHubReference,
  type Risk,
} from "@/lib/schemas/output";
import { canonicalModuleKey } from "@/lib/scoring/module-name";
import { estimateEffort, teamSizeFrom, type EffortEstimate } from "@/lib/scoring/effort";
import { detectRisks, type DetectedRisk } from "@/lib/scoring/risk";
import type { ModuleCandidate } from "@/lib/schemas/extraction";
import type { Session } from "@/lib/schemas/mcq";
import { BudgetExceededError, LLMError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { promptSafe, promptText, truncateText } from "@/lib/text/prompt-safe";
import { coerceClientView, coerceEngineerView } from "@/lib/pipeline/coerce";
import { computeConfidence } from "@/lib/scoring/confidence";

const MAX_CONTEXT_CHARS = 40_000;
/** How much of the brief the finalize context may carry (BUG-06). */
const MAX_RAW_INPUT_CHARS = 12_000;
/** Rough room kept for the extraction and GitHub sections. */
const RESERVED_CONTEXT_CHARS = 8_000;

/**
 * Run client + engineer LLM calls in parallel and return the validated
 * FinalOutput. Both calls receive the same context — the session's enriched
 * input + the latest extraction + the latest GitHub matches + every prior
 * answer — but operate independently.
 *
 * Each call uses prompt caching on its system prompt. The user message is
 * shared content but cannot be cached because it varies per session.
 */
export async function generateOutput(session: Session): Promise<FinalOutput> {
  const t0 = Date.now();
  const [client, engineer] = await Promise.all([
    generateClientView(session),
    generateEngineerView(session),
  ]);
  logger.info("finalize.completed", {
    sessionId: session.id,
    durationMs: Date.now() - t0,
  });
  return { client, engineer };
}

/**
 * The client document alone (one finalize job). The confidence badge is NOT
 * trusted from the LLM — free models routinely emit garbage here (e.g.
 * "1/100" when the real score is 97) — so it is replaced with the
 * deterministic value the pipeline already computed.
 */
export async function generateClientView(session: Session): Promise<ClientView> {
  const context = buildSharedContext(requireRounds(session));
  const t0 = Date.now();
  const client = await runClientView(context);
  logger.info("finalize.client.completed", {
    sessionId: session.id,
    durationMs: Date.now() - t0,
  });
  return {
    ...client,
    modules: client.modules.map((m) => withClientModuleScore(session, m)),
    confidence_badge: computeConfidenceBadge(session),
  };
}

/**
 * The engineer document alone (one finalize job). The effort-estimate
 * confidence band is derived from the real score, not the LLM, so the doc
 * never contradicts the badge.
 */
export async function generateEngineerView(session: Session): Promise<EngineerView> {
  requireRounds(session);
  // Blueprint steps 09 and 10: both are computed here, handed to the model as
  // facts, and written back over whatever it returned.
  const estimate = computeEstimate(session);
  const risks = detectRisks(latestRound(session).extraction);
  const context = buildSharedContext(session, computedBlocks(estimate, risks));
  const t0 = Date.now();
  const engineer = await runEngineerView(context);
  logger.info("finalize.engineer.completed", {
    sessionId: session.id,
    durationMs: Date.now() - t0,
    sprints: estimate.sprints,
    totalPoints: estimate.totalPoints,
    teamSize: estimate.teamSize,
    risks: risks.length,
  });
  return {
    ...engineer,
    module_table: engineer.module_table.map((row) => withEngineerRowScore(session, row)),
    // Real repos only, from the matches this session actually fetched
    // (GOAL-02). Whatever the model wrote here is dropped.
    github_references: buildGitHubReferences(session),
    sprint_breakdown: mergeSprintPlan(estimate, engineer.sprint_breakdown),
    risks: mergeRisks(risks, engineer.risks),
    effort_summary: effortSummaryOf(estimate),
  };
}

/** The latest round; callers have already checked there is one. */
function latestRound(session: Session) {
  return session.rounds[session.rounds.length - 1]!;
}

/**
 * The effort estimate for this session (blueprint step 10). The team size is
 * whatever the user stated in the brief or in an answer, newest first,
 * otherwise the configured default.
 */
export function computeEstimate(session: Session): EffortEstimate {
  const extraction = latestRound(session).extraction;
  const team = teamSizeFrom(statedTeamTexts(session));
  return estimateEffort({
    modules: extraction.modules,
    domain: extraction.domain,
    confidence: session.current_confidence,
    teamSize: team.size,
    teamSizeStated: team.stated,
  });
}

/** The brief and every answer, oldest first, for the team-size read. */
function statedTeamTexts(session: Session): string[] {
  const texts = [session.raw_input];
  for (const round of session.rounds) {
    for (const answer of round.answers) {
      texts.push(answer.selected_options.join(" "));
      if (answer.custom_text) texts.push(answer.custom_text);
    }
    if (round.added_description) texts.push(round.added_description);
  }
  return texts;
}

function requireRounds(session: Session): Session {
  if (session.rounds.length === 0) {
    throw new ValidationError("Session has no rounds to finalize");
  }
  return session;
}

/** The stored estimate: every field from the engine, none from the model. */
function effortSummaryOf(estimate: EffortEstimate): EngineerView["effort_summary"] {
  return {
    total_sprints: estimate.sprints,
    team_size: estimate.teamSize,
    confidence_band: estimate.band.label,
    total_points: estimate.totalPoints,
    velocity: estimate.velocity,
    domain_multiplier: estimate.multiplier,
    team_size_stated: estimate.teamSizeStated,
    basis: estimate.modules.map((m) => ({
      name: m.name,
      size: m.size,
      points: m.points,
    })),
  };
}

/**
 * The sprint rows: modules and points from the plan, the focus line from the
 * model where it wrote one for that sprint. A model that returns eight
 * sprints when the engine computed five cannot stretch the plan.
 */
function mergeSprintPlan(
  estimate: EffortEstimate,
  written: EngineerView["sprint_breakdown"],
): EngineerView["sprint_breakdown"] {
  return estimate.plan.map((row, i) => ({
    sprint: row.sprint,
    focus: written[i]?.focus?.trim() || defaultFocus(row.modules),
    story_points: row.storyPoints,
    modules: row.modules,
  }));
}

function defaultFocus(modules: string[]): string {
  if (modules.length === 0) return "Buffer and stabilisation";
  return `Build ${modules.slice(0, 4).join(", ")}`;
}

/** At most this many risks the model raised on its own are kept. */
const MAX_MODEL_RISKS = 3;

/**
 * The risk list: every rule that fired, with the severity the rule assigned
 * and the model's wording only where it answered that rule id. Risks the
 * model raised by itself are kept after them, tagged "model".
 */
function mergeRisks(detected: DetectedRisk[], written: Risk[]): Risk[] {
  const byRule = new Map(
    written.filter((r) => r.rule_id !== "model").map((r) => [r.rule_id, r]),
  );
  const rules: Risk[] = detected.map((risk) => ({
    severity: risk.severity,
    description: byRule.get(risk.rule_id)?.description?.trim() || risk.description,
    rule_id: risk.rule_id,
  }));
  const ids = new Set(detected.map((r) => r.rule_id as string));
  const extras: Risk[] = written
    .filter((r) => !ids.has(r.rule_id))
    .slice(0, MAX_MODEL_RISKS)
    .map((r) => ({ ...r, rule_id: "model" }));
  return [...rules, ...extras];
}

/**
 * The confidence badge: the score the pipeline computed and every component
 * behind it (ARCH-01) — never the finalize model's own read.
 */
function computeConfidenceBadge(session: Session): ConfidenceBadge {
  const round = session.rounds[session.rounds.length - 1]!;
  const scored = computeConfidence(round.extraction);
  return {
    score: scored.score,
    breakdown: {
      coverage: scored.coverage,
      ai_clarity: scored.quality,
      consistency: scored.consistency,
      github_bonus: scored.githubBonus,
      cap_applied: scored.cap,
    },
  };
}

/** How many repositories the engineer document points at. */
const MAX_REFERENCES = 5;

/**
 * The GitHub references for the document: the round's own matches, the most
 * similar first. Empty when the round found none — the view then says so
 * rather than showing anything invented (GOAL-02).
 */
function buildGitHubReferences(session: Session): GitHubReference[] {
  const matches = session.rounds[session.rounds.length - 1]?.github_enrichment?.matches;
  if (!matches || matches.length === 0) return [];
  return [...matches]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, MAX_REFERENCES)
    .map((m) => ({
      repo: m.repo,
      url: m.url,
      why_relevant:
        m.why_relevant.trim() ||
        `Similar project (similarity ${m.similarity.toFixed(2)})`,
    }));
}

/** The scored module of the latest round that matches this name, if any. */
function scoredModule(session: Session, name: string): ModuleCandidate | undefined {
  const modules = session.rounds[session.rounds.length - 1]?.extraction.modules ?? [];
  const key = canonicalModuleKey(name);
  return modules.find((m) => canonicalModuleKey(m.name) === key);
}

/** The client's module card, with the confidence the pipeline computed. */
function withClientModuleScore(session: Session, module: ClientModule): ClientModule {
  const scored = scoredModule(session, module.name);
  return {
    ...module,
    confidence: scored?.module_confidence ?? null,
    seen_in: scored?.seen_in ?? [],
  };
}

function withEngineerRowScore(
  session: Session,
  row: EngineerModuleRow,
): EngineerModuleRow {
  return {
    ...row,
    confidence: scoredModule(session, row.name)?.module_confidence ?? null,
  };
}

/* ──────────────────────────────────────────────────────────────
 *  Internal: per-view runners
 * ────────────────────────────────────────────────────────────── */

async function runClientView(context: string): Promise<ClientView> {
  let outcome;
  try {
    outcome = await callToolWithRepair({
      label: "finalize.client",
      toolName: submitClientViewTool.name,
      parse: (input) => ClientViewSchema.safeParse(coerceClientView(input)),
      params: {
        model: PromptModel.SONNET,
        max_tokens: 4096,
        system: [
          {
            type: "text",
            text: CLIENT_VIEW_SYSTEM_PROMPT,
            cache_control: ephemeralCacheControl,
          },
        ],
        tools: [submitClientViewTool],
        tool_choice: { type: "tool", name: submitClientViewTool.name },
        messages: [{ role: "user", content: context }],
      },
    });
  } catch (err) {
    // The budget error must reach the route as a 503, not become an LLMError.
    if (err instanceof BudgetExceededError) throw err;
    logger.error("finalize.client.failure", {
      message: err instanceof Error ? err.message : "unknown",
    });
    throw new LLMError("Client view generation failed");
  }

  logger.info("finalize.client.tokens", {
    attempts: outcome.attempts,
    inputTokens: outcome.response.usage.input_tokens,
    outputTokens: outcome.response.usage.output_tokens,
    cacheReadTokens: outcome.response.usage.cache_read_input_tokens ?? 0,
  });

  if (!outcome.ok) {
    logger.error("finalize.client.invalid_output", { issues: outcome.issues });
    throw new LLMError(`Client view failed validation: ${outcome.issues}`);
  }
  return outcome.data;
}

async function runEngineerView(context: string): Promise<EngineerView> {
  let outcome;
  try {
    outcome = await callToolWithRepair({
      label: "finalize.engineer",
      toolName: submitEngineerViewTool.name,
      parse: (input) => EngineerViewSchema.safeParse(coerceEngineerView(input)),
      params: {
        model: PromptModel.SONNET,
        max_tokens: 8192,
        system: [
          {
            type: "text",
            text: ENGINEER_VIEW_SYSTEM_PROMPT,
            cache_control: ephemeralCacheControl,
          },
        ],
        tools: [submitEngineerViewTool],
        tool_choice: { type: "tool", name: submitEngineerViewTool.name },
        messages: [{ role: "user", content: context }],
      },
    });
  } catch (err) {
    // The budget error must reach the route as a 503, not become an LLMError.
    if (err instanceof BudgetExceededError) throw err;
    logger.error("finalize.engineer.failure", {
      message: err instanceof Error ? err.message : "unknown",
    });
    throw new LLMError("Engineer view generation failed");
  }

  logger.info("finalize.engineer.tokens", {
    attempts: outcome.attempts,
    inputTokens: outcome.response.usage.input_tokens,
    outputTokens: outcome.response.usage.output_tokens,
    cacheReadTokens: outcome.response.usage.cache_read_input_tokens ?? 0,
  });

  if (!outcome.ok) {
    logger.error("finalize.engineer.invalid_output", { issues: outcome.issues });
    throw new LLMError(`Engineer view failed validation: ${outcome.issues}`);
  }
  return outcome.data;
}

/* ──────────────────────────────────────────────────────────────
 *  Computed blocks (blueprint steps 09 and 10)
 * ────────────────────────────────────────────────────────────── */

/**
 * The estimate and the risks, written into the engineer's prompt as facts.
 * The model is told plainly that they are already decided: it writes the
 * sprint focus lines and may reword a risk, and every number is overwritten
 * after the call regardless of what it sends.
 */
function computedBlocks(estimate: EffortEstimate, risks: DetectedRisk[]): string {
  const lines: string[] = [];
  lines.push("<computed_estimate>");
  lines.push(
    "Computed by the server. These numbers replace whatever you send, so do not argue with them.",
  );
  lines.push(`domain_multiplier: ${estimate.multiplier} (${estimate.domain})`);
  lines.push(
    `team_size: ${estimate.teamSize} (${estimate.teamSizeStated ? "stated by the client" : "assumed"})`,
  );
  lines.push(`velocity: ${estimate.velocity} story points per 2-week sprint`);
  lines.push(`total_points: ${estimate.totalPoints}`);
  lines.push(`total_sprints: ${estimate.sprints}`);
  lines.push(`confidence_band: ${estimate.band.label}`);
  lines.push("sprint_plan — write one focus line for each, in this order:");
  for (const row of estimate.plan) {
    const modules = row.modules.length > 0 ? row.modules.join(", ") : "carry-over work";
    lines.push(`  ${row.sprint}: ${modules} — ${row.storyPoints} pts`);
  }
  lines.push("</computed_estimate>");

  lines.push("\n<computed_risks>");
  if (risks.length === 0) {
    lines.push("No rule fired. You may add up to 3 risks of your own.");
  } else {
    lines.push(
      'Return one risk per rule_id below, keeping its id and severity; rewrite the description to fit this project if you can say it better. You may add up to 3 risks of your own with rule_id "model".',
    );
    for (const risk of risks) {
      lines.push(`  ${risk.rule_id} [${risk.severity}]: ${risk.description}`);
    }
  }
  lines.push("</computed_risks>");
  return lines.join("\n");
}

/* ──────────────────────────────────────────────────────────────
 *  Context builder
 * ────────────────────────────────────────────────────────────── */

function buildSharedContext(session: Session, computed = ""): string {
  const lastRound = session.rounds[session.rounds.length - 1]!;
  const extraction = lastRound.extraction;
  const enrichment = lastRound.github_enrichment;

  // Everything the user told us, in full: answers first so a long brief or a
  // long GitHub section can never crowd them out (BUG-06).
  const answers = answersHistory(session);
  const rawAllowance = Math.min(
    MAX_RAW_INPUT_CHARS,
    Math.max(1_000, MAX_CONTEXT_CHARS - answers.length - RESERVED_CONTEXT_CHARS),
  );

  const lines: string[] = [];
  lines.push("<session>");
  lines.push(`raw_input: ${promptText(session.raw_input, rawAllowance)}`);
  lines.push(`current_confidence: ${session.current_confidence}`);
  lines.push("</session>");

  lines.push("\n<extraction>");
  lines.push(`domain: ${extraction.domain}`);
  lines.push(`overall_confidence: ${extraction.confidence}`);
  lines.push(`reasoning: ${extraction.confidence_reasoning}`);
  lines.push("parameters:");
  for (const p of extraction.parameters) {
    lines.push(`  ${p.id} ${p.name} [${p.state}]`);
    if (p.evidence) {
      lines.push(`    evidence: "${promptText(p.evidence, 240)}"`);
    }
    if (p.gap) lines.push(`    gap: ${promptText(p.gap, 200)}`);
  }
  lines.push("modules:");
  for (const m of extraction.modules) {
    const v = m.github_validated ? "✓gh" : "   ";
    lines.push(`  ${v} [${m.size}] ${m.name} — ${m.description}`);
    if (m.source_signal) lines.push(`        signal: ${m.source_signal}`);
  }
  if (extraction.assumptions.length > 0) {
    lines.push("assumptions:");
    for (const a of extraction.assumptions) lines.push(`  - ${a}`);
  }
  if (extraction.open_questions.length > 0) {
    lines.push("open_questions:");
    for (const q of extraction.open_questions) lines.push(`  - ${q}`);
  }
  lines.push("</extraction>");

  if (answers) lines.push(`\n${answers}`);

  if (enrichment) {
    lines.push("\n<github_matches>");
    lines.push(`query: ${enrichment.query_used}`);
    for (const m of enrichment.matches) {
      lines.push(`  ${m.repo} (★${m.stars}, sim ${m.similarity.toFixed(2)})`);
      lines.push(`    url: ${m.url}`);
      lines.push(`    description: ${promptText(m.description, 240)}`);
      if (m.why_relevant) {
        lines.push(`    why_relevant: ${promptText(m.why_relevant, 240)}`);
      }
      if (m.modules_found.length > 0) {
        lines.push(`    modules: ${m.modules_found.slice(0, 12).join(", ")}`);
      }
      if (m.folders_found.length > 0) {
        lines.push(`    folders: ${m.folders_found.slice(0, 12).join(", ")}`);
      }
    }
    if (Object.keys(enrichment.module_frequency).length > 0) {
      const top = Object.entries(enrichment.module_frequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15);
      lines.push("module_frequency_across_matches:");
      for (const [name, n] of top) lines.push(`  ${n}× ${name}`);
    }
    lines.push("</github_matches>");
  }

  // The closing instruction and the computed numbers are appended after any
  // trimming, so they are never the part that gets cut.
  const body = truncateText(lines.join("\n"), MAX_CONTEXT_CHARS);
  const tail = computed ? `\n\n${computed}` : "";
  return `${body}${tail}\n\nProduce your output now. Call the appropriate tool exactly once.`;
}

/**
 * Every answer and added description the user gave, in full: this is the
 * most specific information in the whole context (BUG-06).
 */
function answersHistory(session: Session): string {
  const lines: string[] = [];
  for (const r of session.rounds) {
    const parts: string[] = [];
    for (const a of r.answers) {
      const q = r.questions.find((x) => x.id === a.question_id);
      if (!q) continue;
      parts.push(`  param=${q.parameter_id} q=${promptText(q.question, 200)}`);
      if (a.selected_options.length > 0) {
        parts.push(`    selected: ${promptSafe(a.selected_options.join(" | "))}`);
      }
      if (a.custom_text) parts.push(`    custom:   ${promptSafe(a.custom_text)}`);
    }
    if (r.added_description) {
      parts.push(`    added description: ${promptSafe(r.added_description)}`);
    }
    if (parts.length > 0) {
      lines.push(`round ${r.round_number}:`, ...parts);
    }
  }
  if (lines.length === 0) return "";
  return ["<answers_history>", ...lines, "</answers_history>"].join("\n");
}
