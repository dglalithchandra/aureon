import { z } from "zod";
import { SCOPING } from "@/lib/config/scoping";

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
 * Enforce the BLOCKER invariant the LLM is told to obey, by repair rather than
 * rejection: if P-01 or P-03 is MISSING, blocker is forced to true and
 * confidence capped at SCOPING.blockerCap. A misbehaving model therefore can
 * neither bypass the gate nor fail the whole round over a fixable number.
 */
export function repairBlockerInvariant(data: ExtractionResult): ExtractionResult {
  const missing = (id: ParameterId) =>
    data.parameters.find((p) => p.id === id)?.state === "MISSING";
  if (!missing("P-01") && !missing("P-03")) return data;
  return {
    ...data,
    blocker: true,
    confidence: Math.min(data.confidence, SCOPING.blockerCap),
  };
}

/**
 * Validator for the model's extraction: parameters must be ordered P-01..P-09
 * (rejected otherwise), then the blocker invariant is repaired.
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
  },
).transform(repairBlockerInvariant);
