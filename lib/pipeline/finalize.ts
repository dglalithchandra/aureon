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
  type ClientView,
  type EngineerView,
  type FinalOutput,
} from "@/lib/schemas/output";
import type { Session } from "@/lib/schemas/mcq";
import { BudgetExceededError, LLMError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { promptSafe, promptText, truncateText } from "@/lib/text/prompt-safe";
import { coerceClientView, coerceEngineerView } from "@/lib/pipeline/coerce";
import { parameterWeight, stateMultiplier } from "@/lib/config/scoping";

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
  return { ...client, confidence_badge: computeConfidenceBadge(session) };
}

/**
 * The engineer document alone (one finalize job). The effort-estimate
 * confidence band is derived from the real score, not the LLM, so the doc
 * never contradicts the badge.
 */
export async function generateEngineerView(session: Session): Promise<EngineerView> {
  const context = buildSharedContext(requireRounds(session));
  const t0 = Date.now();
  const engineer = await runEngineerView(context);
  logger.info("finalize.engineer.completed", {
    sessionId: session.id,
    durationMs: Date.now() - t0,
  });
  const band = confidenceBand(session.current_confidence);
  return {
    ...engineer,
    effort_summary: { ...engineer.effort_summary, confidence_band: band },
  };
}

function requireRounds(session: Session): Session {
  if (session.rounds.length === 0) {
    throw new ValidationError("Session has no rounds to finalize");
  }
  return session;
}

function confidenceBand(score: number): string {
  if (score < 60) return "low — improve scope before relying on this estimate";
  if (score < 80) return "±35% (medium confidence)";
  return "±20% (high confidence)";
}

/**
 * Deterministic confidence badge derived from the canonical pipeline state
 * — never from the finalize LLM.
 *
 *   score             = session.current_confidence (the number the
 *                       extraction pipeline computed and gated on)
 *   coverage          = tier-weighted parameter-state completeness
 *   llm_quality       = the extraction's own holistic confidence read
 *   github_validation = avg similarity of GitHub matches × 100, or the
 *                       share of modules that got github-validated when
 *                       there are no scored matches
 */
function computeConfidenceBadge(session: Session): {
  score: number;
  breakdown: { coverage: number; llm_quality: number; github_validation: number };
} {
  const round = session.rounds[session.rounds.length - 1]!;
  const ex = round.extraction;

  // Same weights and multipliers the extraction prompt is generated from.
  let num = 0;
  let den = 0;
  for (const p of ex.parameters) {
    const w = parameterWeight(p.id);
    den += w;
    num += w * stateMultiplier(p.state);
  }
  const coverage = den > 0 ? Math.round((num / den) * 100) : 0;

  const enrichment = round.github_enrichment;
  let githubValidation = 0;
  if (enrichment && enrichment.matches.length > 0) {
    const avgSim =
      enrichment.matches.reduce((s, m) => s + m.similarity, 0) /
      enrichment.matches.length;
    githubValidation = Math.round(avgSim * 100);
  } else {
    const total = ex.modules.length || 1;
    const validated = ex.modules.filter((m) => m.github_validated).length;
    githubValidation = Math.round((validated / total) * 100);
  }

  return {
    score: clampInt(session.current_confidence),
    breakdown: {
      coverage: clampInt(coverage),
      llm_quality: clampInt(ex.confidence),
      github_validation: clampInt(githubValidation),
    },
  };
}

function clampInt(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
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
 *  Context builder
 * ────────────────────────────────────────────────────────────── */

function buildSharedContext(session: Session): string {
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

  // The closing instruction is appended after any trimming, so it is never
  // the part that gets cut.
  return `${truncateText(lines.join("\n"), MAX_CONTEXT_CHARS)}\n\nProduce your output now. Call the appropriate tool exactly once.`;
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
