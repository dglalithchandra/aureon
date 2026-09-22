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
        description: `Overall confidence 0-100. Hard cap at ${SCOPING.blockerCap} if blocker is true.`,
      },
      confidence_reasoning: {
        type: "string",
        maxLength: 800,
        description:
          "One short paragraph explaining the score. Cite which parameters dragged it down.",
      },
      blocker: {
        type: "boolean",
        description: `True iff P-01 (Goal) or P-03 (Features) is MISSING. When true, confidence MUST be <= ${SCOPING.blockerCap}.`,
      },
    },
  },
};

/**
 * The "Confidence scoring" section of the system prompt, generated from
 * lib/config/scoping.ts so the weights and caps the model is told always
 * match the ones the server uses.
 */
export function buildScoringRubric(config: ScopingConfig = SCOPING): string {
  const weights = config.parameters.map((p) => `${p.id}: ${p.weight}`).join(", ");
  const multipliers = Object.entries(config.stateMultipliers)
    .map(([state, m]) => `${state}=${m.toFixed(1)}`)
    .join(", ");
  const coveragePct = Math.round(config.promptCoverageBlend * 100);
  return [
    "# Confidence scoring",
    "",
    "Use this rubric for the overall confidence number 0-100:",
    "  - Coverage component: weighted average of parameter states. Weights:",
    `      ${weights}`,
    `      State multipliers: ${multipliers}`,
    "  - Quality component: are features described precisely enough to build? Are user roles defined? Are NFRs stated?",
    `  - Blend ~${coveragePct}% coverage + ${100 - coveragePct}% quality. Round to integer.`,
    `  - Cap at ${config.blockerCap} if blocker.`,
  ].join("\n");
}

/**
 * System prompt. Cached on every call (cache_control: ephemeral on the last
 * content block). The prompt is intentionally long because it carries the
 * full parameter rubric — caching makes that essentially free after warm-up.
 */
export const EXTRACTION_SYSTEM_PROMPT = `You are ScopeAI — a senior consultant who turns raw, messy client requirements into a structured project scope.

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
  - Set confidence <= ${SCOPING.blockerCap} (no exceptions)
  - Still extract everything else you can — the BLOCKER question generator runs separately

If both P-01 and P-03 have any non-MISSING state:
  - Set blocker = false
  - Compute confidence honestly (see scoring below)

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
  - Be honest about gaps. A high confidence score on a thin input misleads the team.
  - Surface every assumption you make. The client edits these later.
`;
