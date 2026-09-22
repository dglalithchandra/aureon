import "@/lib/server-only";
import {
  ephemeralCacheControl,
  createLlmMessage,
  PromptModel,
} from "@/lib/llm/anthropic";
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
import { stripHtml, truncateText } from "@/lib/security/sanitize";
import { coerceClientView, coerceEngineerView } from "@/lib/pipeline/coerce";
import { parameterWeight, stateMultiplier } from "@/lib/config/scoping";

const MAX_CONTEXT_CHARS = 40_000;

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
  const lastRound = session.rounds[session.rounds.length - 1];
  if (!lastRound) {
    throw new ValidationError("Session has no rounds to finalize");
  }
  const context = buildSharedContext(session);

  const t0 = Date.now();
  const [client, engineer] = await Promise.all([
    runClientView(context),
    runEngineerView(context),
  ]);
  logger.info("finalize.completed", {
    sessionId: session.id,
    durationMs: Date.now() - t0,
  });

  // The confidence badge is NOT trusted from the LLM — free models routinely
  // emit garbage here (e.g. "1/100" when the real score is 97). We overwrite
  // it with the deterministic value the pipeline already computed.
  const badge = computeConfidenceBadge(session);

  // The effort-estimate confidence band is also a derived value, not an
  // LLM judgement — tie it to the real score so the doc never contradicts
  // the badge.
  const band = confidenceBand(session.current_confidence);

  return {
    client: { ...client, confidence_badge: badge },
    engineer: {
      ...engineer,
      effort_summary: { ...engineer.effort_summary, confidence_band: band },
    },
  };
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
  let response;
  try {
    response = await createLlmMessage({
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
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
  });

  const tu = response.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> =>
      b.type === "tool_use" && b.name === submitClientViewTool.name,
  );
  if (!tu) throw new LLMError("Client view: model did not call tool");

  const parsed = ClientViewSchema.safeParse(coerceClientView(tu.input));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    logger.error("finalize.client.zod_failure", { issues });
    throw new ValidationError(`Client view failed validation: ${issues}`);
  }
  return parsed.data;
}

async function runEngineerView(context: string): Promise<EngineerView> {
  let response;
  try {
    response = await createLlmMessage({
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
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
  });

  const tu = response.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> =>
      b.type === "tool_use" && b.name === submitEngineerViewTool.name,
  );
  if (!tu) throw new LLMError("Engineer view: model did not call tool");

  const parsed = EngineerViewSchema.safeParse(coerceEngineerView(tu.input));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    logger.error("finalize.engineer.zod_failure", { issues });
    throw new ValidationError(`Engineer view failed validation: ${issues}`);
  }
  return parsed.data;
}

/* ──────────────────────────────────────────────────────────────
 *  Context builder
 * ────────────────────────────────────────────────────────────── */

function buildSharedContext(session: Session): string {
  const lastRound = session.rounds[session.rounds.length - 1]!;
  const extraction = lastRound.extraction;
  const enrichment = lastRound.github_enrichment;

  const lines: string[] = [];
  lines.push("<session>");
  lines.push(`raw_input: ${truncateText(stripHtml(session.raw_input), 4000)}`);
  lines.push(`enriched_input: ${truncateText(stripHtml(session.enriched_input), 6000)}`);
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
      lines.push(`    evidence: "${truncateText(p.evidence, 240)}"`);
    }
    if (p.gap) lines.push(`    gap: ${truncateText(p.gap, 200)}`);
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

  if (enrichment) {
    lines.push("\n<github_matches>");
    lines.push(`query: ${enrichment.query_used}`);
    for (const m of enrichment.matches) {
      lines.push(`  ${m.repo} (★${m.stars}, sim ${m.similarity.toFixed(2)})`);
      lines.push(`    url: ${m.url}`);
      lines.push(`    description: ${truncateText(m.description, 240)}`);
      if (m.why_relevant) {
        lines.push(`    why_relevant: ${truncateText(m.why_relevant, 240)}`);
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

  if (session.rounds.length > 1) {
    lines.push("\n<answers_history>");
    for (const r of session.rounds) {
      if (r.answers.length === 0) continue;
      lines.push(`round ${r.round_number}:`);
      for (const a of r.answers) {
        const q = r.questions.find((x) => x.id === a.question_id);
        if (!q) continue;
        lines.push(`  param=${q.parameter_id} q=${truncateText(q.question, 120)}`);
        if (a.selected_options.length > 0) {
          lines.push(`    selected: ${a.selected_options.join(" | ")}`);
        }
        if (a.custom_text) {
          lines.push(`    custom:   ${truncateText(a.custom_text, 240)}`);
        }
      }
    }
    lines.push("</answers_history>");
  }

  lines.push("\nProduce your output now. Call the appropriate tool exactly once.");

  return truncateText(lines.join("\n"), MAX_CONTEXT_CHARS);
}
