import type { z } from "zod";
import type {
  ExtractionResult,
  ParameterId,
  ParameterStateSchema,
} from "@/lib/schemas/extraction";
import type {
  ExtractModulesToolOutput,
  GitHubEnrichment,
  GitHubMatch,
} from "@/lib/schemas/github";
import type {
  QuestionGenToolOutputSchema,
  Session,
  SessionRound,
} from "@/lib/schemas/mcq";
import type { ClientView, EngineerView } from "@/lib/schemas/output";
import { SCOPING } from "@/lib/config/scoping";

/**
 * Schema-valid fixtures shared by unit tests and the mock LLM server.
 * Every factory returns a fresh object, so tests may mutate the result.
 */

type ParameterState = z.infer<typeof ParameterStateSchema>;
type QuestionGenToolOutput = z.infer<typeof QuestionGenToolOutputSchema>;

export const MOCK_TOOL_NAMES = [
  "submit_extraction",
  "generate_clarification_questions",
  "submit_client_view",
  "submit_engineer_view",
  "extract_modules",
] as const;
export type MockToolName = (typeof MOCK_TOOL_NAMES)[number];

const PARAMETER_NAMES = Object.fromEntries(
  SCOPING.parameters.map((p) => [p.id, p.name]),
) as Record<ParameterId, string>;

const DEFAULT_STATES: Record<ParameterId, ParameterState> = {
  "P-01": "PRESENT",
  "P-02": "PARTIAL_THIN",
  "P-03": "PRESENT",
  "P-04": "MISSING",
  "P-05": "PARTIAL_THIN",
  "P-06": "MISSING",
  "P-07": "MISSING",
  "P-08": "MISSING",
  "P-09": "MISSING",
};

/**
 * Evidence is kept to words in lib/github/search.ts GENERIC_FEATURE_TERMS and
 * P-04 has no evidence (no `language:` hint), so with domain "Zz" the default
 * extraction makes buildQueryVariants return [] and no GitHub call happens.
 */
const DEFAULT_EVIDENCE: Partial<Record<ParameterId, string>> = {
  "P-01": "Internal tool so the team can manage client accounts.",
  "P-02": "Account managers.",
  "P-03": "User accounts, admin roles and login.",
  "P-05": "Some kind of email service.",
};

export function makeParameters(
  states: Partial<Record<ParameterId, ParameterState>> = {},
): ExtractionResult["parameters"] {
  const ids = Object.keys(PARAMETER_NAMES) as ParameterId[];
  return ids.map((id) => {
    const state = states[id] ?? DEFAULT_STATES[id];
    return {
      id,
      name: PARAMETER_NAMES[id],
      state,
      evidence: state === "MISSING" ? null : (DEFAULT_EVIDENCE[id] ?? null),
      gap: state === "PRESENT" ? null : `More detail needed on ${PARAMETER_NAMES[id]}.`,
    };
  });
}

export function makeExtraction(
  overrides: Partial<ExtractionResult> = {},
): ExtractionResult {
  return {
    domain: "Zz",
    domain_confidence: 40,
    parameters: makeParameters(),
    modules: [
      {
        name: "Auth",
        description: "Sign-in and sessions for staff.",
        size: "MEDIUM",
        source_signal: "Mentioned: login",
        github_validated: false,
        module_confidence: null,
        seen_in: [],
      },
      {
        name: "Admin",
        description: "Admin screens to manage roles.",
        size: "SMALL",
        source_signal: "Mentioned: admin roles",
        github_validated: false,
        module_confidence: null,
        seen_in: [],
      },
      {
        name: "Users",
        description: "User account records.",
        size: "SMALL",
        source_signal: "Mentioned: user accounts",
        github_validated: false,
        module_confidence: null,
        seen_in: [],
      },
    ],
    assumptions: ["Single organisation, no multi-tenancy."],
    open_questions: ["Who are the primary users?"],
    confidence: 45,
    confidence_reasoning:
      "Goal and features are stated; users, budget and timeline are thin.",
    blocker: false,
    ...overrides,
  };
}

export function makeQuestionsPayload(
  parameterIds: ParameterId[] = ["P-02", "P-07", "P-08"],
): QuestionGenToolOutput {
  return {
    questions: parameterIds.map((id) => ({
      parameter_id: id,
      question: `Which option best describes the ${PARAMETER_NAMES[id]}?`,
      options: ["Option A", "Option B", "Option C"],
      is_blocker: false,
    })),
  };
}

export function makeClientView(): ClientView {
  return {
    project_summary:
      "An internal tool that lets account managers look after client accounts in one place.",
    modules: [
      {
        name: "Auth",
        description: "Staff sign-in.",
        size: "MEDIUM",
        github_validated: false,
        confidence: null,
        seen_in: [],
      },
    ],
    milestones: [{ phase: "Month 1", name: "Foundation", deliverables: ["Sign-in"] }],
    assumptions: ["Single organisation."],
    open_items: ["Confirm the budget."],
    // Deliberately wrong: generateOutput must overwrite the LLM's badge.
    confidence_badge: {
      score: 12,
      breakdown: {
        coverage: 1,
        ai_clarity: 2,
        consistency: 3,
        github_bonus: 4,
        cap_applied: 5,
      },
    },
  };
}

export function makeEngineerView(): EngineerView {
  return {
    module_table: [
      {
        name: "Auth",
        confidence: null,
        tech_stack: ["Next.js"],
        size: "MEDIUM",
        dependencies: [],
        api_endpoints: ["POST /api/login"],
        notes: "HttpOnly session cookie.",
      },
    ],
    build_order: ["Auth"],
    database_sketch: [{ table: "users", fields: ["id UUID"], relations: [] }],
    auth_model: { roles: ["admin"], permissions_matrix: { admin: ["accounts:write"] } },
    third_party_checklist: [],
    sprint_breakdown: [
      { sprint: "Sprint 1", focus: "Auth", story_points: 13, modules: ["Auth"] },
    ],
    testing_strategy: [],
    security_per_module: { Auth: ["Rate-limit login"] },
    // Deliberately wrong severity and an unknown id: the server keeps its own
    // severities for computed rules (blueprint step 09).
    risks: [{ severity: "NOTE", description: "Budget unknown.", rule_id: "model" }],
    // Deliberately invented: the server must replace these with the round's
    // real matches (GOAL-02).
    github_references: [
      {
        repo: "made-up/nonexistent-repo",
        url: "https://github.com/made-up/nonexistent-repo",
        why_relevant: "The model made this up",
      },
    ],
    // Deliberately wrong: the effort engine (blueprint step 10) overwrites
    // every one of these numbers.
    effort_summary: {
      total_sprints: 3,
      team_size: 2,
      confidence_band: "LLM guess",
      total_points: 999,
      velocity: 99,
      domain_multiplier: 2.5,
      team_size_stated: true,
      basis: [],
      calibration: null,
    },
  };
}

/** A GitHub match as the enrichment stores it. */
export function makeMatch(overrides: Partial<GitHubMatch> = {}): GitHubMatch {
  const repo = overrides.repo ?? "acme/shop-core";
  return {
    repo,
    url: `https://github.com/${repo}`,
    description: "Marketplace with seller payouts",
    stars: 900,
    similarity: 0.7,
    modules_found: ["Auth", "Payouts"],
    folders_found: ["Billing"],
    why_relevant: "Same payout flow",
    ...overrides,
  };
}

/** An enrichment containing the given matches. */
export function makeEnrichment(matches: GitHubMatch[] = [makeMatch()]): GitHubEnrichment {
  return {
    matches,
    module_frequency: {},
    module_repos: {},
    query_used: "q",
    variants: [],
  };
}

export function makeExtractModulesPayload(): ExtractModulesToolOutput {
  return {
    modules: ["Auth", "Billing", "Dashboard"],
    similarity_to_project: 0.7,
    why_relevant: "Same account-management dashboard with role-based access",
  };
}

export function defaultToolPayload(tool: MockToolName): unknown {
  switch (tool) {
    case "submit_extraction":
      return makeExtraction();
    case "generate_clarification_questions":
      return makeQuestionsPayload();
    case "submit_client_view":
      return makeClientView();
    case "submit_engineer_view":
      return makeEngineerView();
    case "extract_modules":
      return makeExtractModulesPayload();
  }
}

export function makeRound(overrides: Partial<SessionRound> = {}): SessionRound {
  return {
    round_number: 0,
    extraction: makeExtraction(),
    github_enrichment: null,
    questions: [],
    answers: [],
    added_description: null,
    ...overrides,
  };
}

export function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "12345678-1234-4abc-8def-1234567890ab",
    raw_input: "hello",
    enriched_input: "hello",
    rounds: [],
    status: "analyzing",
    pipeline_stage: "extracting",
    current_confidence: 0,
    final_output: null,
    draft_output: null,
    owner_id: null,
    last_error: null,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}
