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
import { computeConfidence } from "@/lib/scoring/confidence";
import { scoreModules } from "@/lib/scoring/modules";
import { budgetExceededMessage, utf8Bytes, withinBudget } from "@/lib/text/budget";
import { promptSafe } from "@/lib/text/prompt-safe";

/** One budget for the brief, every answer and every description (BUG-10). */
function requireWithinBudget(bytes: number): void {
  if (!withinBudget(bytes)) throw new ValidationError(budgetExceededMessage(bytes));
}

/* ──────────────────────────────────────────────────────────────
 *  Public API
 * ────────────────────────────────────────────────────────────── */

/**
 * Create a fresh session. The caller persists it before invoking `runRound`,
 * allowing the client to poll the live pipeline stage from the outset.
 * `ownerId` is the creating browser's owner id (BUG-03); POST /api/session
 * always passes it, null is the legacy per-session-cookie mode.
 */
export function createSession(rawText: string, ownerId: string | null = null): Session {
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
    owner_id: ownerId,
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
  if (session.rounds.length >= SCOPING.maxTotalRounds) {
    throw new ValidationError(
      `This session has used all ${SCOPING.maxTotalRounds} rounds. Start a new scope.`,
    );
  }
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

  // 1) Run the LLM extraction on the brief plus everything added since, as
  //    separate blocks: the answers are written first and never truncated
  //    away, however long the brief is (BUG-06).
  const extractionRaw = await runExtraction({
    rawText: working.raw_input,
    priorContext: priorContext(working.rounds),
  });

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

  // 3) Merge GitHub signals into the extraction, then score every module
  //    (blueprint step 07) so the views can show what is solid and what is
  //    only a candidate.
  await enterStage("scoring");
  const merged = enrichment
    ? mergeGitHubSignals(extractionRaw, enrichment)
    : extractionRaw;
  const extraction = scoreModules(merged, enrichment);

  // 4) Decide next status. BLOCKER short-circuits everything else.
  let questions: MCQQuestion[] = [];
  let nextStatus: Session["status"];
  await enterStage("clarifying");

  if (extraction.blocker) {
    // BUG-05: while the goal or core features are missing, a round never
    // ends "ready". After blockerMaxRounds tries (or when no further round
    // would fit) the user is asked for a fuller description instead.
    const lastPossibleRound = roundNumber + 1 >= SCOPING.maxTotalRounds;
    if (
      blockerRoundStreak(working) + 1 >= SCOPING.blockerMaxRounds ||
      lastPossibleRound
    ) {
      nextStatus = "needs_input";
    } else {
      questions = await generateBlockerQuestion(working, extraction);
      nextStatus = questions.length > 0 ? "blocker" : "needs_input";
    }
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
    added_description: null,
  };

  return {
    ...working,
    rounds: [...working.rounds, newRound],
    status: nextStatus,
    pipeline_stage: null,
    last_error: null,
    // Computed here from the parameter states, never taken from the model
    // (ARCH-01).
    current_confidence: computeConfidence(extraction).score,
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

  // One budget for everything the user typed, in UTF-8 bytes (BUG-10).
  requireWithinBudget(sumUserBytes(session, validatedAnswers));

  // Persist the answers on the current round and advance.
  const updatedRounds = [...session.rounds];
  updatedRounds[updatedRounds.length - 1] = {
    ...currentRound,
    answers: validatedAnswers,
  };

  return {
    ...session,
    rounds: updatedRounds,
    enriched_input: enrichedInput(session, updatedRounds),
    status: "analyzing",
    pipeline_stage: "extracting",
    updated_at: Date.now(),
  };
}

/**
 * Record the fuller description the user typed while the session was
 * "needs_input" (BUG-05) and leave it "analyzing" for the next round, which
 * re-extracts from the old text plus the new one. POST
 * /api/session/[id]/describe stores this and queues the round as a job.
 */
export function applyDescription(session: Session, text: string): Session {
  if (session.status !== "needs_input") {
    throw new ValidationError(
      `Cannot add a description when session status is ${session.status}`,
    );
  }
  if (session.rounds.length >= SCOPING.maxTotalRounds) {
    throw new ValidationError(
      `This session has used all ${SCOPING.maxTotalRounds} rounds. Start a new scope.`,
    );
  }
  const currentRound = session.rounds[session.rounds.length - 1];
  if (!currentRound) {
    throw new ValidationError("Session has no current round");
  }

  const description = text.trim();
  if (!description) {
    throw new ValidationError("Describe the goal and main features in a few sentences");
  }
  requireWithinBudget(sumUserBytes(session, []) + utf8Bytes(description));

  // The next round re-extracts from everything: the original text, every
  // answer so far and this description.
  const updatedRounds = [...session.rounds];
  updatedRounds[updatedRounds.length - 1] = {
    ...currentRound,
    added_description: description,
  };

  return {
    ...session,
    rounds: updatedRounds,
    enriched_input: enrichedInput(session, updatedRounds),
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
  return generateQuestions({
    extraction,
    askedBefore: collectAskedParams(session),
    roundNumber: session.rounds.length,
    // A blocker asked before is re-asked, so the model needs the wording
    // that already failed (BUG-05).
    previousQuestions: session.rounds.flatMap((r) => r.questions),
  });
}

/**
 * Consecutive rounds that ended with a blocker question, counting back from
 * the latest. A round that asked for a fuller description instead (no
 * question) ends the streak, so answering a rewrite starts the count again.
 */
function blockerRoundStreak(session: Session): number {
  let streak = 0;
  for (let i = session.rounds.length - 1; i >= 0; i--) {
    const round = session.rounds[i];
    if (!round?.extraction.blocker || round.questions.length === 0) break;
    streak++;
  }
  return streak;
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
 * Every number here is the computed score (ARCH-01), so the same input
 * always makes the same ready/ask decision.
 *
 * Exported for unit tests.
 */
export function shouldExit(session: Session, newExtraction: ExtractionResult): boolean {
  const score = computeConfidence(newExtraction).score;
  if (score >= SCOPING.confidenceThreshold) {
    return true;
  }
  // No further round would fit in the session (BUG-05).
  if (session.rounds.length + 1 >= SCOPING.maxTotalRounds) {
    return true;
  }
  if (session.rounds.length >= SCOPING.maxRounds) {
    return true;
  }
  if (session.rounds.length >= 2) {
    const scoreOf = (round: SessionRound | undefined): number | undefined =>
      round ? computeConfidence(round.extraction).score : undefined;
    const prev = scoreOf(session.rounds[session.rounds.length - 1]);
    const prevPrev = scoreOf(session.rounds[session.rounds.length - 2]);
    if (prev !== undefined && prevPrev !== undefined) {
      const d1 = score - prev;
      const d2 = prev - prevPrev;
      if (d1 < SCOPING.diminishingDelta && d2 < SCOPING.diminishingDelta) {
        return true;
      }
    }
  }
  return false;
}

/** One round's answers, or "" when it has none. */
function buildAnswerBlock(round: SessionRound): string {
  const lines: string[] = [];
  for (const a of round.answers) {
    const q = round.questions.find((x) => x.id === a.question_id);
    if (!q) continue;
    // The user's own words go inside our tags, so they must not close them.
    lines.push(`Parameter: ${q.parameter_id}`);
    lines.push(`Question: ${promptSafe(q.question)}`);
    if (a.selected_options.length > 0) {
      lines.push(`Selected: ${promptSafe(a.selected_options.join(" | "))}`);
    }
    if (a.custom_text) {
      lines.push(`Custom: ${promptSafe(a.custom_text)}`);
    }
    lines.push("");
  }
  if (lines.length === 0) return "";
  // The round number is written once, so the tags always match (BUG-11).
  const n = round.round_number + 1;
  return [`<round n="${n}">`, ...lines, `</round>`].join("\n");
}

/**
 * Everything the user added after the brief — answers and descriptions — in
 * stable, matching tags (BUG-11). This is what the extraction prompt keeps
 * whole; the raw brief takes whatever budget is left (BUG-06).
 */
function priorContext(rounds: SessionRound[]): string {
  const blocks: string[] = [];
  for (const round of rounds) {
    const answers = buildAnswerBlock(round);
    if (answers) blocks.push(answers);
    if (round.added_description) {
      blocks.push(buildDescriptionBlock(round));
    }
  }
  return blocks.join("\n\n");
}

/** The stored transcript: the brief followed by everything added since. */
function enrichedInput(session: Session, rounds: SessionRound[]): string {
  const prior = priorContext(rounds);
  return prior ? `${session.raw_input}\n\n${prior}` : session.raw_input;
}

function buildDescriptionBlock(round: SessionRound): string {
  return [
    `<added_description n="${round.round_number + 1}">`,
    promptSafe(round.added_description ?? ""),
    "</added_description>",
  ].join("\n");
}

function sumUserBytes(session: Session, newAnswers: MCQAnswer[]): number {
  let total = utf8Bytes(session.raw_input);
  for (const r of session.rounds) {
    for (const a of r.answers) total += answerBytes(a);
    if (r.added_description) total += utf8Bytes(r.added_description);
  }
  for (const a of newAnswers) total += answerBytes(a);
  return total;
}

function answerBytes(a: MCQAnswer): number {
  let n = a.custom_text ? utf8Bytes(a.custom_text) : 0;
  for (const opt of a.selected_options) n += utf8Bytes(opt);
  return n;
}
