import { z } from "zod";

/**
 * Extraction schemas — the structured shape the LLM must return.
 *
 * The LLM emits this via Anthropic tool use (`submit_extraction`), so the
 * Zod schemas serve two roles:
 *   1. Source of truth for the JSON Schema attached to the tool definition.
 *   2. Runtime validator that runs on every tool_use response — never trust
 *      LLM output without validation.
 */

export const ParameterStateSchema = z.enum([
  "PRESENT",
  "PARTIAL_DEEP",
  "PARTIAL_THIN",
  "MISSING",
]);
export type ParameterState = z.infer<typeof ParameterStateSchema>;

export const ParameterIdSchema = z.enum([
  "P-01",
  "P-02",
  "P-03",
  "P-04",
  "P-05",
  "P-06",
  "P-07",
  "P-08",
  "P-09",
]);
export type ParameterId = z.infer<typeof ParameterIdSchema>;

export const ModuleSizeSchema = z.enum(["SMALL", "MEDIUM", "LARGE"]);
export type ModuleSize = z.infer<typeof ModuleSizeSchema>;

export const ParameterSchema = z.object({
  id: ParameterIdSchema,
  name: z.string().min(1).max(120),
  state: ParameterStateSchema,
  evidence: z.string().max(800).nullable(),
  gap: z.string().max(400).nullable(),
});
export type Parameter = z.infer<typeof ParameterSchema>;

export const ModuleCandidateSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(400),
  size: ModuleSizeSchema,
  source_signal: z.string().min(1).max(300),
  github_validated: z.boolean().default(false),
});
export type ModuleCandidate = z.infer<typeof ModuleCandidateSchema>;

/**
 * Top-level result. `parameters` is fixed-length 9, ordered P-01..P-09.
 */
export const ExtractionResultSchema = z.object({
  domain: z.string().min(1).max(60),
  domain_confidence: z.number().int().min(0).max(100),
  parameters: z.array(ParameterSchema).length(9),
  modules: z.array(ModuleCandidateSchema).max(40),
  assumptions: z.array(z.string().min(1).max(400)).max(30),
  open_questions: z.array(z.string().min(1).max(400)).max(30),
  confidence: z.number().int().min(0).max(100),
  confidence_reasoning: z.string().min(1).max(800),
  blocker: z.boolean(),
});
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

/**
 * Refined validator — enforces the BLOCKER invariant the LLM is told to obey.
 * If P-01 or P-03 is MISSING then blocker MUST be true and confidence
 * MUST be <= 40. We re-check here so a misbehaving LLM cannot bypass the gate.
 */
export const ExtractionResultStrictSchema = ExtractionResultSchema.superRefine(
  (data, ctx) => {
    const orderedIds: ParameterId[] = [
      "P-01",
      "P-02",
      "P-03",
      "P-04",
      "P-05",
      "P-06",
      "P-07",
      "P-08",
      "P-09",
    ];

    data.parameters.forEach((p, idx) => {
      if (p.id !== orderedIds[idx]) {
        ctx.addIssue({
          code: "custom",
          path: ["parameters", idx, "id"],
          message: `Parameter at index ${idx} must be ${orderedIds[idx]}, got ${p.id}`,
        });
      }
    });

    const p01 = data.parameters.find((p) => p.id === "P-01");
    const p03 = data.parameters.find((p) => p.id === "P-03");
    const shouldBlock =
      p01?.state === "MISSING" || p03?.state === "MISSING";

    if (shouldBlock && !data.blocker) {
      ctx.addIssue({
        code: "custom",
        path: ["blocker"],
        message: "blocker must be true when P-01 or P-03 is MISSING",
      });
    }
    if (shouldBlock && data.confidence > 40) {
      ctx.addIssue({
        code: "custom",
        path: ["confidence"],
        message: "confidence must be <= 40 when P-01 or P-03 is MISSING",
      });
    }
  },
);

export const ExtractRequestSchema = z.object({
  rawText: z.string().min(1).max(50_000),
  priorContext: z.string().max(50_000).optional(),
});
export type ExtractRequest = z.infer<typeof ExtractRequestSchema>;
