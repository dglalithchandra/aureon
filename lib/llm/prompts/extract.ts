import type Anthropic from "@anthropic-ai/sdk";
import { SCOPING, type ScopingConfig } from "@/lib/config/scoping";

/**
 * The submit_extraction tool. The LLM is forced to call this tool — there
 * is no free-form text path. The shape mirrors `ExtractionResultSchema` in
 * lib/schemas/extraction.ts; if you change one, change the other.
 *
 * We hand-write the JSON Schema (rather than auto-converting from Zod)
 * because Anthropic's tool input_schema accepts a small subset of JSON Schema
 * and rejects refinements like superRefine. Keeping it explicit also lets us
 * write per-field descriptions that act as inline documentation for the model.
 */
export const submitExtractionTool: Anthropic.Tool = {
  name: "submit_extraction",
  description:
    "Submit the structured extraction of a software project description. Always call this tool exactly once per response. Do not emit free-form text.",
  input_schema: {
    type: "object",
    required: [
      "domain",
      "domain_confidence",
      "parameters",
      "modules",
      "assumptions",
      "open_questions",
      "confidence",
      "confidence_reasoning",
      "blocker",
    ],
    properties: {
      domain: {
        type: "string",
        description:
          "Best-fit domain label, free-form. Common values: SaaS, E-Commerce, Marketplace, FinTech, EdTech, Healthcare, Mobile App, Internal Tool, Content Platform. Use 'Other' if none fit.",
        maxLength: 60,
      },
      domain_confidence: {
        type: "integer",
        minimum: 0,
        maximum: 100,
        description: "How confident you are in the domain label, 0-100.",
      },
      parameters: {
        type: "array",
        description:
          "Exactly 9 entries, ordered P-01 through P-09. Always include all 9, even if MISSING.",
        minItems: 9,
        maxItems: 9,
        items: {
          type: "object",
          required: ["id", "name", "state", "evidence", "gap"],
          properties: {
            id: {
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
            name: { type: "string", maxLength: 120 },
            state: {
              type: "string",
              enum: ["PRESENT", "PARTIAL_DEEP", "PARTIAL_THIN", "MISSING"],
            },
            evidence: {
              type: ["string", "null"],
              maxLength: 800,
              description:
                "Quote from the input that supports this state. Null if MISSING.",
            },
            gap: {
              type: ["string", "null"],
              maxLength: 400,
              description:
                "What information is needed to upgrade this parameter. Null if PRESENT.",
            },
          },
        },
      },
      modules: {
        type: "array",
        maxItems: 40,
        description:
          "Likely modules / pages / major components. Inferred from features, domain, and standard patterns.",
        items: {
          type: "object",
          required: ["name", "description", "size", "source_signal"],
          properties: {
            name: { type: "string", maxLength: 80 },
            description: { type: "string", maxLength: 400 },
            size: { type: "string", enum: ["SMALL", "MEDIUM", "LARGE"] },
            source_signal: {
              type: "string",
              maxLength: 300,
              description:
                "Why this module is included — quote of the supporting feature, or 'standard for <domain>'.",
            },
          },
        },
      },
      assumptions: {
        type: "array",
        maxItems: 30,
        items: { type: "string", maxLength: 400 },
        description:
          "Every assumption you made because something was not specified. Be explicit so the client can correct them.",
      },
      open_questions: {
        type: "array",
        maxItems: 30,
        items: { type: "string", maxLength: 400 },
        description:
          "Specific questions that, if answered, would upgrade the lowest-scoring parameters.",
      },
      confidence: {
        type: "integer",
        minimum: 0,
        maximum: 100,
        description:
          "Your CLARITY READ 0-100: how clearly this brief describes a buildable product. It is one input to the score the server computes; do not try to compute that score.",
      },
      confidence_reasoning: {
        type: "string",
        maxLength: 800,
        description:
          "ONE line explaining the clarity read. Name what made the brief clear or unclear.",
      },
      blocker: {
        type: "boolean",
        description:
          "True iff P-01 (Goal) or P-03 (Features) is MISSING. The server caps the score in that case; you do not.",
      },
    },
  },
};

/**
 * The "Clarity read" section of the system prompt (ARCH-01). The server
 * computes the confidence score from the parameter states it has validated;
 * the model contributes one component, so this tells it what that component
 * is and — explicitly — that it is not the score.
 */
export function buildScoringRubric(config: ScopingConfig = SCOPING): string {
  return [
    "# Clarity read (the confidence field)",
    "",
    "You do NOT compute the project's confidence score. The server computes it",
    "from the parameter states you return, and caps it when a BLOCKER or HIGH",
    `parameter is MISSING (${config.blockerCap} and ${config.criticalCap}).`,
    "",
    "`confidence` is your CLARITY READ 0-100 — how clearly this brief describes",
    "a product somebody could build:",
    "  90-100  precise and unambiguous, a developer could start today",
    "  70-89   clear intent, some details left to assume",
    "  40-69   understandable but vague in important places",
    "  0-39    hard to tell what is wanted at all",
    "",
    "Judge how clear the writing is, not how complete the scope is — the",
    "parameter states already carry completeness.",
    "`confidence_reasoning` is ONE line naming what made it clear or unclear.",
  ].join("\n");
}

/**
 * System prompt. Cached on every call (cache_control: ephemeral on the last
 * content block). The prompt is intentionally long because it carries the
 * full parameter rubric — caching makes that essentially free after warm-up.
 */
export const EXTRACTION_SYSTEM_PROMPT = `You are Aureon — a senior consultant who turns raw, messy client requirements into a structured project scope.

Your job: read the client's text and call the submit_extraction tool exactly once with a complete analysis. Never reply with free-form text.

# The 9 parameters (always evaluate all of them)

P-01 — Project Goal / Problem Statement
  The fundamental problem the software solves. The "why". Without this, nothing else makes sense.
  PRESENT: clear problem statement, with users and outcome.
  PARTIAL_DEEP: problem named but missing user or outcome.
  PARTIAL_THIN: vague gesture ("an app for restaurants").
  MISSING: no problem stated at all.

P-02 — Target Users / Personas
  Who uses the system. Roles, permissions, distinct user types.
  PRESENT: roles named with responsibilities (admin, customer, vendor, etc.).
  PARTIAL_DEEP: roles named but no responsibilities.
  PARTIAL_THIN: only "users" or "people".
  MISSING: no users mentioned.

P-03 — Core Features / Functionality
  The list of things the system actually does. The "what".
  PRESENT: 3+ concrete features with enough detail to estimate.
  PARTIAL_DEEP: features listed but vague ("manage users").
  PARTIAL_THIN: 1-2 generic features.
  MISSING: no features at all.

P-04 — Technical Constraints / Stack Preferences
  React/Node/AWS/mobile/existing systems to integrate with.
  PRESENT: explicit stack or constraint.
  PARTIAL_DEEP: platform mentioned (web/mobile) without stack.
  PARTIAL_THIN: ambiguous hint ("modern stack").
  MISSING: nothing.

P-05 — Third-Party Integrations
  Stripe, Razorpay, Twilio, Salesforce, Google OAuth, etc.
  PRESENT: specific integrations named.
  PARTIAL_DEEP: category named ("payment gateway") without provider.
  PARTIAL_THIN: vague ("email notifications").
  MISSING: nothing.

P-06 — Non-Functional Requirements
  Performance, uptime, compliance (HIPAA/PCI/GDPR), accessibility, retention.
  PRESENT: specific NFRs with targets.
  PARTIAL_DEEP: NFR mentioned without target ("fast", "secure").
  PARTIAL_THIN: implied ("for enterprise").
  MISSING: nothing.

P-07 — Budget Range
  Hard ceiling, range, or relative scale.
  PRESENT: number or range.
  PARTIAL_DEEP: relative ("startup budget", "enterprise budget").
  PARTIAL_THIN: hint ("affordable", "premium").
  MISSING: nothing.

P-08 — Delivery Timeline
  When it must be live. MVP vs full launch.
  PRESENT: date or week count.
  PARTIAL_DEEP: relative ("by Q3", "ASAP").
  PARTIAL_THIN: hint ("quickly").
  MISSING: nothing.

P-09 — Success Metrics / Definition of Done
  KPIs, acceptance criteria, what "done" looks like.
  PRESENT: measurable metrics.
  PARTIAL_DEEP: qualitative goals.
  PARTIAL_THIN: vague intent.
  MISSING: nothing.

# BLOCKER rule (mandatory)

If P-01 OR P-03 is MISSING:
  - Set blocker = true
  - Still extract everything else you can — the BLOCKER question generator runs separately
  - The server caps the score; you only report your clarity read honestly

If both P-01 and P-03 have any non-MISSING state:
  - Set blocker = false

${buildScoringRubric()}

# Module extraction

For each clear feature, propose modules. Use standard names (Auth, Dashboard, Billing, Notifications, etc.). Size them:
  SMALL  = simple CRUD or static page (1-2 day frontend, basic API)
  MEDIUM = auth, complex UI, webhook, async jobs (3-7 days)
  LARGE  = real-time, ML, multi-tenant, payment engine (1-2 weeks)

Always include modules that are STANDARD for the domain even if the client did not name them (Auth, Settings) — but mark source_signal as "standard for <domain>".

# Output rules

  - Always call submit_extraction exactly once.
  - Always emit all 9 parameters in order P-01..P-09.
  - Never invent specific integrations the user did not mention. If they said "payments", P-05 is PARTIAL_DEEP, not PRESENT.
  - Quote evidence verbatim from the input. Do not paraphrase the quote.
  - Be honest about gaps. A high clarity read on a thin input misleads the team.
  - Surface every assumption you make. The client edits these later.
`;
