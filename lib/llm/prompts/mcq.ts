import type { LlmTool } from "@/lib/llm/types";

export const generateQuestionsTool: LlmTool = {
  name: "generate_clarification_questions",
  description:
    "Emit 1-3 multiple-choice clarification questions targeting the highest-impact missing or thin parameters. Always call this tool exactly once.",
  input_schema: {
    type: "object",
    required: ["questions"],
    properties: {
      questions: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: {
          type: "object",
          required: ["parameter_id", "question", "options", "is_blocker"],
          properties: {
            parameter_id: {
              type: "string",
              enum: [
                "P-01",
                "P-02",
                "P-03",
                "P-04",
                "P-05",
                "P-06",
                "P-07",
                "P-08",
                "P-09",
              ],
            },
            question: {
              type: "string",
              maxLength: 400,
              description:
                "One sentence, plain English, ends with '?'. If targeting a PARTIAL parameter, quote the existing evidence so the user sees what's already known.",
            },
            options: {
              type: "array",
              minItems: 3,
              maxItems: 8,
              items: { type: "string", maxLength: 200 },
              description:
                "Domain-aware options. Concrete answers, not categories. Last option is conventionally 'Other / I'll describe'.",
            },
            is_blocker: {
              type: "boolean",
              description:
                "True iff this question is for a MISSING P-01 (Goal) or P-03 (Features) parameter.",
            },
          },
        },
      },
    },
  },
};

export const MCQ_SYSTEM_PROMPT = `You write clarification questions for Aureon's iterative scoping interview.

Inputs you receive:
  - The current ExtractionResult (domain, all 9 parameters with state/evidence/gap, modules, confidence).
  - A list of parameter ids already asked in prior rounds — do not re-ask them.
  - Sometimes a <reframe> block: a BLOCKER parameter that is still MISSING after
    being asked. Ask about it AGAIN, with different wording and different options.
  - The number of rounds completed so far (0..3).

Your job: emit 1-3 MCQ questions that, when answered, would lift the lowest-scoring parameters fastest.

# Priority order (always)

  1. BLOCKER first. If extraction.blocker = true (P-01 or P-03 MISSING), emit ONLY ONE question targeting whichever of those is MISSING. is_blocker = true.
  2. Otherwise: HIGH-weight MISSING (P-02 Users, P-04 Tech) before MED-weight, before LOW.
  3. Then PARTIAL_THIN, then PARTIAL_DEEP. Skip PRESENT.
  4. Skip parameters in askedBefore — except one named in <reframe>, which must be re-asked.

# Question style

  - One sentence, ends with '?'.
  - For PARTIAL parameters: open with "You mentioned <evidence>. Which of these…" so the user sees what's already understood.
  - 3-8 options. Concrete and specific. Mutually exclusive when possible.
  - Last option is always 'Other (describe)'.
  - Domain-aware. Examples:
      FinTech P-05: Stripe / Razorpay / Plaid / Adyen / PayPal / Other
      SaaS P-04:    Next.js / Remix / Rails / Django / NestJS / Existing in-house / Other
      Healthcare P-06: HIPAA compliant / SOC 2 / GDPR / None required yet / Other
      E-Commerce P-03: Catalog / Cart / Checkout / Inventory / Reviews / Returns / Subscriptions / Other
      Mobile App P-04: iOS only / Android only / Both / React Native / Flutter / Native / Other
      Internal Tool P-02: Specific named team / Cross-functional / External vendors / Other

# Output

Always call generate_clarification_questions exactly once. No free-form text. Never include UUIDs — the system assigns them.`;
