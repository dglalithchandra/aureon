import "@/lib/server-only";
import { randomUUID } from "node:crypto";
import { promptModel } from "@/lib/llm/client";
import { callToolWithRepair } from "@/lib/llm/structured";
import { generateQuestionsTool, MCQ_SYSTEM_PROMPT } from "@/lib/llm/prompts/mcq";
import {
  MCQQuestionSchema,
  QuestionGenToolOutputSchema,
  type MCQQuestion,
} from "@/lib/schemas/mcq";
import { type ExtractionResult, type ParameterId } from "@/lib/schemas/extraction";
import { SCOPING } from "@/lib/config/scoping";
import { BudgetExceededError, LLMError } from "@/lib/errors";
import { logger } from "@/lib/logger";

const MAX_QUESTIONS = 3;

export interface GenerateQuestionsOptions {
  extraction: ExtractionResult;
  askedBefore: ParameterId[];
  roundNumber: number;
  /** For the logs (OBS-01). */
  sessionId?: string;
  /**
   * Questions from earlier rounds. A MISSING blocker parameter is asked
   * again (BUG-05), and the model is shown the wording that did not work.
   */
  previousQuestions?: MCQQuestion[];
}

/**
 * Run one model call to produce 1-3 MCQ questions targeting the
 * lowest-scoring parameters. Server assigns UUIDs after Zod validation.
 *
 * Returns an empty array on transport / parse failure (caller treats this
 * as "no useful questions" and gracefully degrades to ready/finalize).
 */
export async function generateQuestions(
  opts: GenerateQuestionsOptions,
): Promise<MCQQuestion[]> {
  const {
    extraction,
    askedBefore,
    roundNumber,
    previousQuestions = [],
    sessionId,
  } = opts;
  const blockerExpected = isBlockerExtraction(extraction);
  // A MISSING blocker parameter may always be asked again, with different
  // framing; everything else is asked once (BUG-05).
  const isAskable = (id: ParameterId): boolean =>
    !askedBefore.includes(id) || isBlockerParam(extraction, id);

  // Pre-filter: nothing to ask if every non-PRESENT param is already asked.
  const candidates = extraction.parameters.filter(
    (p) => p.state !== "PRESENT" && isAskable(p.id),
  );
  if (candidates.length === 0) {
    return blockerExpected ? [blockerFallbackQuestion(extraction)] : [];
  }

  const reask = askedBefore.filter((id) => isBlockerParam(extraction, id));
  const userBlocks: string[] = [];
  userBlocks.push(`<round_number>${roundNumber}</round_number>`);
  const askedOnce = askedBefore.filter((id) => !reask.includes(id));
  userBlocks.push(`<asked_before>${askedOnce.join(", ") || "(none)"}</asked_before>`);
  if (reask.length > 0) {
    userBlocks.push(reframeBlock(reask, extraction, previousQuestions));
  }
  userBlocks.push(
    `<extraction>\n${formatExtractionForPrompt(extraction)}\n</extraction>`,
  );
  userBlocks.push("Call generate_clarification_questions now.");

  const t0 = Date.now();
  let outcome;
  try {
    outcome = await callToolWithRepair({
      label: "mcq",
      toolName: generateQuestionsTool.name,
      parse: (input) => QuestionGenToolOutputSchema.safeParse(input),
      params: {
        tier: "main",
        model: promptModel("main"),
        max_tokens: 2048,
        system: MCQ_SYSTEM_PROMPT,
        tools: [generateQuestionsTool],
        tool_choice: { type: "tool", name: generateQuestionsTool.name },
        messages: [{ role: "user", content: userBlocks.join("\n\n") }],
      },
    });
  } catch (err) {
    // The budget error must reach the route as a 503, not become an LLMError.
    if (err instanceof BudgetExceededError) throw err;
    const message = err instanceof Error ? err.message : "unknown";
    logger.error("mcq.provider_failure", { sessionId, roundNumber, message });
    throw new LLMError("MCQ generation failed");
  }

  logger.info("mcq.completed", {
    durationMs: Date.now() - t0,
    attempts: outcome.attempts,
    inputTokens: outcome.response.usage.input_tokens,
    outputTokens: outcome.response.usage.output_tokens,
  });

  if (!outcome.ok) {
    // Still invalid after the repair retry: no usable questions this round.
    logger.warn("mcq.invalid_output", { sessionId, roundNumber, issues: outcome.issues });
    return blockerExpected ? [blockerFallbackQuestion(extraction)] : [];
  }

  // Filter: drop any question whose parameter was already asked. Also enforce
  // BLOCKER mode — when the extraction is in BLOCKER state, we only return
  // the first BLOCKER question, ignore the rest.
  const filtered: MCQQuestion[] = [];
  for (const item of outcome.data.questions) {
    if (!isAskable(item.parameter_id)) continue;
    if (blockerExpected && !isBlockerParam(extraction, item.parameter_id)) continue;
    if (filtered.length >= MAX_QUESTIONS) break;

    const candidate: MCQQuestion = {
      id: randomUUID(),
      parameter_id: item.parameter_id,
      question: item.question,
      options: ensureOtherOption(item.options),
      allow_custom: true,
      is_blocker: blockerExpected
        ? isBlockerParam(extraction, item.parameter_id)
        : item.is_blocker,
    };
    const finalCheck = MCQQuestionSchema.safeParse(candidate);
    if (!finalCheck.success) continue;
    filtered.push(finalCheck.data);

    if (blockerExpected) break; // BLOCKER mode → exactly one question.
  }

  // A blocker round must always leave the user something to answer, so it
  // never ends up looking "ready" (BUG-05).
  if (blockerExpected && filtered.length === 0) {
    logger.warn("mcq.blocker_fallback", { sessionId, roundNumber });
    return [blockerFallbackQuestion(extraction)];
  }

  return filtered;
}

/** The parameter a blocker question targets: whichever blocker is MISSING. */
function missingBlockerParam(e: ExtractionResult): ParameterId {
  return (["P-01", "P-03"] as const).find((id) => isBlockerParam(e, id)) ?? "P-01";
}

/** The static question from config, used when the model gives nothing usable. */
function blockerFallbackQuestion(e: ExtractionResult): MCQQuestion {
  return {
    id: randomUUID(),
    parameter_id: missingBlockerParam(e),
    question: SCOPING.blockerFallback.question,
    options: [...SCOPING.blockerFallback.options],
    allow_custom: true,
    is_blocker: true,
  };
}

/**
 * Tell the model that its earlier framing of a blocker question did not
 * work, so it writes a different one instead of repeating itself.
 */
function reframeBlock(
  reask: ParameterId[],
  e: ExtractionResult,
  previousQuestions: MCQQuestion[],
): string {
  const lines = ["<reframe>"];
  for (const id of reask) {
    const param = e.parameters.find((p) => p.id === id);
    const previous = previousQuestions.filter((q) => q.parameter_id === id).pop();
    lines.push(
      `${id} ${param?.name ?? ""} is STILL MISSING after being asked before, so that framing did not work.`,
    );
    if (previous) {
      lines.push(`  previous question: "${previous.question}"`);
      lines.push(`  previous options: ${previous.options.join(" | ")}`);
    }
  }
  lines.push(
    "Ask about it again using DIFFERENT wording and DIFFERENT options: plainer language, a concrete everyday framing, no jargon.",
  );
  lines.push("</reframe>");
  return lines.join("\n");
}

function isBlockerExtraction(e: ExtractionResult): boolean {
  return e.blocker;
}

function isBlockerParam(e: ExtractionResult, id: ParameterId): boolean {
  if (id !== "P-01" && id !== "P-03") return false;
  const p = e.parameters.find((x) => x.id === id);
  return p?.state === "MISSING";
}

function ensureOtherOption(options: string[]): string[] {
  const lastIsOther =
    options.length > 0 && /^other\b/i.test(options[options.length - 1]!.trim());
  if (lastIsOther) return options;
  if (options.length >= 8) {
    // Replace the last option with "Other (describe)" rather than overflow.
    return [...options.slice(0, 7), "Other (describe)"];
  }
  return [...options, "Other (describe)"];
}

/**
 * Format the extraction in a compact, prompt-friendly way. We omit modules
 * and assumptions because the question generator does not need them.
 */
function formatExtractionForPrompt(e: ExtractionResult): string {
  const lines: string[] = [];
  lines.push(`Domain: ${e.domain} (confidence ${e.domain_confidence})`);
  lines.push(`Overall confidence: ${e.confidence}`);
  lines.push(`Blocker: ${e.blocker}`);
  lines.push("Parameters:");
  for (const p of e.parameters) {
    lines.push(`  ${p.id} ${p.name} [${p.state}]`);
    if (p.evidence) lines.push(`    evidence: "${truncate(p.evidence, 160)}"`);
    if (p.gap) lines.push(`    gap: ${truncate(p.gap, 160)}`);
  }
  if (e.open_questions.length > 0) {
    lines.push("Existing open questions:");
    for (const q of e.open_questions.slice(0, 5)) lines.push(`  - ${q}`);
  }
  return lines.join("\n");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
