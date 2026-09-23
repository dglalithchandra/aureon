import { z } from "zod";
import { ParameterIdSchema, ParameterStateSchema } from "@/lib/schemas/extraction";
import { SCOPING } from "@/lib/config/scoping";

/**
 * The shape of one file in evals/cases/.
 *
 * A case is an input plus a hand-written label: what the extraction *should*
 * say about it. `label_status` is "draft" until the owner has reviewed the
 * label — the report says so, and draft labels measure agreement with a
 * guess, not with ground truth.
 */

export const CASE_TAGS = [
  "thin",
  "blocker",
  "long",
  "indian-language",
  "injection",
  "rich",
  "medium",
] as const;
export type CaseTag = (typeof CASE_TAGS)[number];

const ExpectedParametersSchema = z
  .record(ParameterIdSchema, ParameterStateSchema)
  .refine(
    (states) => SCOPING.parameters.every((p) => states[p.id] !== undefined),
    "expected.parameters must label all nine parameters (P-01 … P-09)",
  );

export const EvalCaseSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]+$/, "id must be lowercase kebab-case")
    .max(60),
  /** "draft" until the owner has reviewed it; only "reviewed" is ground truth. */
  label_status: z.enum(["draft", "reviewed"]),
  tags: z.array(z.enum(CASE_TAGS)).min(1),
  /** The client text fed to the extraction, exactly as a user would paste it. */
  text: z.string().min(1),
  expected: z.object({
    /**
     * The domain family the extraction should land in, compared loosely
     * (see domainFamily). null for inputs with no inferable domain — those
     * cases are left out of the domain accuracy.
     */
    domain: z.string().min(1).nullable(),
    blocker: z.boolean(),
    parameters: ExpectedParametersSchema,
    /** Modules a usable scope must contain; drives the recall metric. */
    must_have_modules: z.array(z.string().min(1)),
    /**
     * Text that must never appear anywhere in the extraction — the payload of
     * a prompt-injection case. Matched case-insensitively.
     */
    forbidden_strings: z.array(z.string().min(1)).default([]),
  }),
  /** Why the label says what it says, in one or two sentences. */
  notes: z.string().min(1),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;

/** One model call for one case. */
export interface RunResult {
  caseId: string;
  run: number;
  ok: boolean;
  error?: string;
  latencyMs: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    attempts: number;
  };
  /** Present when ok. */
  observed?: {
    domain: string;
    blocker: boolean;
    parameters: Record<string, string>;
    modules: string[];
    score: number;
    decision: "ready" | "ask";
    /** Forbidden strings from the label that turned up in the output. */
    leaked: string[];
  };
}
