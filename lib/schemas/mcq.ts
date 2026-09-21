import { z } from "zod";
import { ExtractionResultSchema, ParameterIdSchema } from "@/lib/schemas/extraction";
import { GitHubEnrichmentSchema } from "@/lib/schemas/github";
import { FinalOutputSchema } from "@/lib/schemas/output";

/**
 * MCQ question shape. UUIDs (v4 only) so the answer payload cannot reference
 * an arbitrary string the client invents — we look the question up by id.
 */
export const MCQQuestionSchema = z.object({
  id: z.string().uuid(),
  parameter_id: ParameterIdSchema,
  question: z.string().min(5).max(400),
  options: z.array(z.string().min(1).max(200)).min(3).max(8),
  allow_custom: z.literal(true),
  is_blocker: z.boolean(),
});
export type MCQQuestion = z.infer<typeof MCQQuestionSchema>;

export const MCQAnswerSchema = z.object({
  question_id: z.string().uuid(),
  selected_options: z.array(z.string().min(1).max(200)).max(8),
  custom_text: z.string().max(2_000).nullable(),
});
export type MCQAnswer = z.infer<typeof MCQAnswerSchema>;

/**
 * The model's tool output for question generation.
 *
 * NOTE: the LLM does NOT supply UUIDs — we generate them server-side after
 * validation so the model cannot collide ids across rounds or pre-fabricate
 * known ids that match cached answers.
 */
export const QuestionGenToolItemSchema = z.object({
  parameter_id: ParameterIdSchema,
  question: z.string().min(5).max(400),
  options: z.array(z.string().min(1).max(200)).min(3).max(8),
  is_blocker: z.boolean(),
});
export type QuestionGenToolItem = z.infer<typeof QuestionGenToolItemSchema>;

export const QuestionGenToolOutputSchema = z.object({
  questions: z.array(QuestionGenToolItemSchema).min(1).max(3),
});
export type QuestionGenToolOutput = z.infer<typeof QuestionGenToolOutputSchema>;

/* ──────────────────────────────────────────────────────────────
 *  Session
 * ────────────────────────────────────────────────────────────── */

export const SessionStatusSchema = z.enum([
  "analyzing",
  "awaiting_answers",
  "blocker",
  "ready",
  "finalized",
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/** The live server-side phase shown by the chat roadmap while a round runs. */
export const PipelineStageSchema = z.enum([
  "extracting",
  "github",
  "scoring",
  "clarifying",
]);
export type PipelineStage = z.infer<typeof PipelineStageSchema>;

export const SessionRoundSchema = z.object({
  round_number: z.number().int().min(0).max(10),
  extraction: ExtractionResultSchema,
  github_enrichment: GitHubEnrichmentSchema.nullable(),
  questions: z.array(MCQQuestionSchema).max(3),
  answers: z.array(MCQAnswerSchema).max(3),
});
export type SessionRound = z.infer<typeof SessionRoundSchema>;

export const SessionSchema = z.object({
  id: z.string().uuid(),
  raw_input: z.string().min(1).max(50_000),
  enriched_input: z.string().max(100_000),
  rounds: z.array(SessionRoundSchema).max(10),
  status: SessionStatusSchema,
  pipeline_stage: PipelineStageSchema.nullable().default(null),
  current_confidence: z.number().int().min(0).max(100),
  final_output: FinalOutputSchema.nullable().default(null),
  created_at: z.number().int(),
  updated_at: z.number().int(),
});
export type Session = z.infer<typeof SessionSchema>;

/* ──────────────────────────────────────────────────────────────
 *  Public API request shapes
 * ────────────────────────────────────────────────────────────── */

export const CreateSessionRequestSchema = z.object({
  rawText: z.string().min(1).max(50_000),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

export const SubmitAnswersRequestSchema = z.object({
  answers: z.array(MCQAnswerSchema).min(0).max(3),
});
export type SubmitAnswersRequest = z.infer<typeof SubmitAnswersRequestSchema>;
