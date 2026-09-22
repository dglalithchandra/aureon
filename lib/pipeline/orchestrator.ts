import "@/lib/server-only";
import { randomUUID } from "node:crypto";
import { runExtraction } from "@/lib/pipeline/extract";
import { enrichWithGitHub } from "@/lib/pipeline/github-enrich";
import { mergeGitHubSignals } from "@/lib/pipeline/merge";
import { generateQuestions } from "@/lib/pipeline/mcq";
import {
  type MCQAnswer,
  type MCQQuestion,
  type PipelineStage,
  type Session,
  type SessionRound,
} from "@/lib/schemas/mcq";
import type { ExtractionResult, ParameterId } from "@/lib/schemas/extraction";
import { AppError, BudgetExceededError, LLMError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { SCOPING } from "@/lib/config/scoping";

/** Combined byte cap on raw_input plus every answer's text. */
const USER_CONTENT_BUDGET_BYTES = 50_000;

/* ──────────────────────────────────────────────────────────────
 *  Public API
 * ────────────────────────────────────────────────────────────── */

/**
 * Create a fresh session. The caller persists it before invoking `runRound`,
 * allowing the client to poll the live pipeline stage from the outset.
 */
export function createSession(rawText: string): Session {
  const id = randomUUID();
  const now = Date.now();
  return {
    id,
    raw_input: rawText,
    enriched_input: rawText,
    rounds: [],
    status: "analyzing",
    pipeline_stage: "extracting",
    current_confidence: 0,
    final_output: null,
    draft_output: null,
    last_error: null,
    created_at: now,
    updated_at: now,
  };
}

type ProgressReporter = (session: Session) => Promise<void>;

/**
 * Drive the state machine forward by one round. Idempotent on terminal
 * states (`ready` and `finalized`) — returns the session unchanged.
 *
 *   round 0     → extract + github enrich → questions OR ready OR blocker
 *   round N>=1  → re-extract on enriched input → recompute → questions OR ready
 *
 * If the round fails, the session is persisted (through `reportProgress`) in
 * status "error" with `last_error`, keeping enriched_input and the answers,
 * so POST /run can resume it (BUG-02). The error is rethrown as LLMError
 * (502); an exhausted AI budget stays BudgetExceededError (503).
 */
export async function runRound(
  session: Session,
  reportProgress?: ProgressReporter,
): Promise<Session> {
  if (session.status === "ready" || session.status === "finalized") {
    return session;
  }

  try {
    return await executeRound(session, reportProgress);
  } catch (err) {
    const failed = markRoundFailed(session, err);
    logger.error("orchestrator.round.failed", {
      sessionId: session.id,
      roundNumber: session.rounds.length,
      code: failed.last_error?.code,
      message: err instanceof Error ? err.message : "unknown",
    });
    try {
      await reportProgress?.(failed);
    } catch (persistErr) {
      logger.error("orchestrator.round.failed_persist", {
        sessionId: session.id,
        message: persistErr instanceof Error ? persistErr.message : "unknown",
      });
    }
    if (err instanceof BudgetExceededError || err instanceof LLMError) throw err;
    throw new LLMError("The AI pipeline failed");
  }
}

/** The session as stored after a failed round: resumable from enriched_input. */
export function markRoundFailed(session: Session, err: unknown): Session {
  const budget = err instanceof BudgetExceededError;
  const known = err instanceof AppError;
  return {
    ...session,
    status: "error",
    pipeline_stage: null,
    last_error: {
      code: known ? err.code : "LLM_ERROR",
      message: (known ? err.message : "The AI pipeline failed").slice(0, 400),
      at: Date.now(),
      // Retrying cannot help until the daily budget resets.
      retryable: !budget,
    },
    updated_at: Date.now(),
  };
}

async function executeRound(
  session: Session,
  reportProgress?: ProgressReporter,
): Promise<Session> {
  const roundStart = Date.now();
  let working = await setPipelineStage(session, "extracting", reportProgress);

  // Log how long each stage took (OPS-01): the previous stage ends when the
  // next one starts.
  let stage: PipelineStage = "extracting";
  let stageStart = roundStart;
  const endStage = (): void => {
    logger.info("orchestrator.stage.completed", {
      sessionId: session.id,
      stage,
      durationMs: Date.now() - stageStart,
    });
  };
  const enterStage = async (next: PipelineStage): Promise<void> => {
    endStage();
    stage = next;
    stageStart = Date.now();
    working = await setPipelineStage(working, next, reportProgress);
  };

  const roundNumber = working.rounds.length;
  logger.info("orchestrator.round.start", {
    sessionId: working.id,
    roundNumber,
    status: working.status,
  });

  // 1) Run the LLM extraction on the current enriched_input.
  const extractionRaw = await runExtraction({ rawText: working.enriched_input });

  // 2) GitHub enrichment runs only on round 0 OR if the domain changed.
  //    On later rounds we re-use the previous enrichment for cost savings.
  let enrichment =
    roundNumber === 0
      ? null
      : (working.rounds[roundNumber - 1]?.github_enrichment ?? null);

  const previousDomain =
    roundNumber === 0
      ? null
      : (working.rounds[roundNumber - 1]?.extraction.domain ?? null);

  const shouldRunEnrichment =
    roundNumber === 0 || (previousDomain && previousDomain !== extractionRaw.domain);

  if (shouldRunEnrichment) {
    await enterStage("github");
    try {
      enrichment = await enrichWithGitHub(extractionRaw, working.enriched_input);
    } catch (err) {
      // An exhausted AI budget is fatal for the round, not a GitHub hiccup.
      if (err instanceof BudgetExceededError) throw err;
      // GitHub failures are non-fatal — proceed with no enrichment.
      logger.warn("orchestrator.github_enrich_failed", {
        sessionId: working.id,
        message: err instanceof Error ? err.message : "unknown",
      });
      enrichment = null;
    }
  }

  // 3) Merge GitHub signals into the extraction.
  await enterStage("scoring");
  const extraction = enrichment
    ? mergeGitHubSignals(extractionRaw, enrichment)
    : extractionRaw;

  // 4) Decide next status. BLOCKER short-circuits everything else.
  let questions: MCQQuestion[] = [];
  let nextStatus: Session["status"];
  await enterStage("clarifying");

  if (extraction.blocker) {
    questions = await generateBlockerQuestion(working, extraction);
    nextStatus = questions.length > 0 ? "blocker" : "ready";
  } else if (shouldExit(working, extraction)) {
    nextStatus = "ready";
  } else {
    const askedBefore = collectAskedParams(working);
    questions = await generateQuestions({
      extraction,
      askedBefore,
      roundNumber,
    });
    nextStatus = questions.length > 0 ? "awaiting_answers" : "ready";
  }

  endStage();
  logger.info("orchestrator.round.completed", {
    sessionId: session.id,
    roundNumber,
    status: nextStatus,
    durationMs: Date.now() - roundStart,
  });

  const newRound: SessionRound = {
    round_number: roundNumber,
    extraction,
    github_enrichment: enrichment,
    questions,
    answers: [],
  };

  return {
    ...working,
    rounds: [...working.rounds, newRound],
    status: nextStatus,
    pipeline_stage: null,
    last_error: null,
    current_confidence: extraction.confidence,
    updated_at: Date.now(),
  };
}

/**
 * Apply MCQ answers to the latest round, append a structured context block
 * to enriched_input, and immediately run the next round.
 */
export async function submitAnswers(
  session: Session,
  answers: MCQAnswer[],
  reportProgress?: ProgressReporter,
): Promise<Session> {
  return runRound(applyAnswers(session, answers), reportProgress);
}

/**
 * Record MCQ answers on the latest round and append a structured context
 * block to enriched_input, leaving the session "analyzing" for the next
 * round. POST /answer stores this and queues the round as a job.
 *
 *   - Validates answer.question_id matches a question issued in the current round.
 *   - Enforces the 50KB user-content cap.
 *   - A ready or finalized session is returned unchanged.
 */
export function applyAnswers(session: Session, answers: MCQAnswer[]): Session {
  if (session.status === "ready" || session.status === "finalized") {
    return session;
  }
  if (session.status !== "awaiting_answers" && session.status !== "blocker") {
    throw new ValidationError(
      `Cannot submit answers when session status is ${session.status}`,
    );
  }

  const currentRound = session.rounds[session.rounds.length - 1];
  if (!currentRound) {
    throw new ValidationError("Session has no current round");
  }

  // Verify every answer references a real outstanding question.
  const validQuestionIds = new Set(currentRound.questions.map((q) => q.id));
  const validatedAnswers: MCQAnswer[] = [];
  for (const a of answers) {
    if (!validQuestionIds.has(a.question_id)) {
      throw new ValidationError(`Unknown question_id ${a.question_id}`);
    }
    validatedAnswers.push(a);
  }

  // Reconstruct enriched_input with a labeled context block per answer.
  const newContextBlock = buildAnswerBlock(currentRound.questions, validatedAnswers);
  const enrichedInputCandidate = `${session.enriched_input}\n\n${newContextBlock}`.slice(
    0,
    100_000,
  );

  // 50KB cap on user-supplied content (raw_input + answer texts).
  const userBytes = sumUserBytes(session, validatedAnswers);
  if (userBytes > USER_CONTENT_BUDGET_BYTES) {
    throw new ValidationError(
      `User content exceeds ${USER_CONTENT_BUDGET_BYTES} byte budget`,
    );
  }

  // Persist the answers on the current round and advance.
  const updatedRounds = [...session.rounds];
  updatedRounds[updatedRounds.length - 1] = {
    ...currentRound,
    answers: validatedAnswers,
  };

  return {
    ...session,
    rounds: updatedRounds,
    enriched_input: enrichedInputCandidate,
    status: "analyzing",
    pipeline_stage: "extracting",
    updated_at: Date.now(),
  };
}

async function setPipelineStage(
  session: Session,
  pipelineStage: PipelineStage,
  reportProgress?: ProgressReporter,
): Promise<Session> {
  const updated: Session = {
    ...session,
    status: "analyzing",
    pipeline_stage: pipelineStage,
    updated_at: Date.now(),
  };
  await reportProgress?.(updated);
  return updated;
}

/* ──────────────────────────────────────────────────────────────
 *  Helpers
 * ────────────────────────────────────────────────────────────── */

async function generateBlockerQuestion(
  session: Session,
  extraction: ExtractionResult,
): Promise<MCQQuestion[]> {
  const askedBefore = collectAskedParams(session);
  return generateQuestions({
    extraction,
    askedBefore,
    roundNumber: session.rounds.length,
  });
}

function collectAskedParams(session: Session): ParameterId[] {
  const asked = new Set<ParameterId>();
  for (const r of session.rounds) {
    for (const q of r.questions) asked.add(q.parameter_id);
  }
  return Array.from(asked);
}

/**
 * Decide if the loop should exit. Three exit criteria:
 *   1. Confidence >= SCOPING.confidenceThreshold
 *   2. Completed rounds >= SCOPING.maxRounds
 *   3. Diminishing returns: confidence delta < SCOPING.diminishingDelta for 2 rounds
 *
 * Exported for unit tests.
 */
export function shouldExit(session: Session, newExtraction: ExtractionResult): boolean {
  if (newExtraction.confidence >= SCOPING.confidenceThreshold) {
    return true;
  }
  if (session.rounds.length >= SCOPING.maxRounds) {
    return true;
  }
  if (session.rounds.length >= 2) {
    const prev = session.rounds[session.rounds.length - 1]?.extraction.confidence;
    const prevPrev = session.rounds[session.rounds.length - 2]?.extraction.confidence;
    if (prev !== undefined && prevPrev !== undefined) {
      const d1 = newExtraction.confidence - prev;
      const d2 = prev - prevPrev;
      if (d1 < SCOPING.diminishingDelta && d2 < SCOPING.diminishingDelta) {
        return true;
      }
    }
  }
  return false;
}

function buildAnswerBlock(questions: MCQQuestion[], answers: MCQAnswer[]): string {
  const lines: string[] = [];
  lines.push(`<round_${Date.now()}>`);
  for (const a of answers) {
    const q = questions.find((x) => x.id === a.question_id);
    if (!q) continue;
    lines.push(`Parameter: ${q.parameter_id}`);
    lines.push(`Question: ${q.question}`);
    if (a.selected_options.length > 0) {
      lines.push(`Selected: ${a.selected_options.join(" | ")}`);
    }
    if (a.custom_text) {
      lines.push(`Custom: ${a.custom_text}`);
    }
    lines.push("");
  }
  lines.push(`</round_${Date.now()}>`);
  return lines.join("\n");
}

function sumUserBytes(session: Session, newAnswers: MCQAnswer[]): number {
  let total = Buffer.byteLength(session.raw_input, "utf8");
  for (const r of session.rounds) {
    for (const a of r.answers) total += answerBytes(a);
  }
  for (const a of newAnswers) total += answerBytes(a);
  return total;
}

function answerBytes(a: MCQAnswer): number {
  let n = a.custom_text ? Buffer.byteLength(a.custom_text, "utf8") : 0;
  for (const opt of a.selected_options) n += Buffer.byteLength(opt, "utf8");
  return n;
}
