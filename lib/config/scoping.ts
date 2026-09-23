import type { ParameterId, ParameterState } from "@/lib/schemas/extraction";

/**
 * Scoping configuration — the single source of truth for the 9 parameters,
 * their weights, the state multipliers and the round / exit rules.
 *
 * Read by the pipeline (exit rules, deterministic badge), the extraction
 * prompt (its scoring rubric is generated from this file) and the chat /
 * output UI. It must therefore stay free of server-only imports.
 */

export type ParameterTier = "BLOCKER" | "HIGH" | "MED" | "LOW";

export interface ScopingParameter {
  readonly id: ParameterId;
  readonly name: string;
  readonly tier: ParameterTier;
  readonly weight: number;
  readonly description: string;
}

/** A static question the pipeline can always fall back to. */
export interface FallbackQuestion {
  readonly question: string;
  readonly options: readonly string[];
}

export interface ScopingConfig {
  /** Ordered P-01 … P-09. */
  readonly parameters: readonly ScopingParameter[];
  readonly stateMultipliers: Readonly<Record<ParameterState, number>>;
  /** Confidence at or above which clarification stops. */
  readonly confidenceThreshold: number;
  /** Clarification rounds after round 0 before the loop stops regardless. */
  readonly maxRounds: number;
  /** Two consecutive confidence gains below this count as diminishing returns. */
  readonly diminishingDelta: number;
  /** Confidence ceiling while a HIGH parameter (P-02, P-04) is MISSING. */
  readonly criticalCap: number;
  /** Confidence ceiling while a BLOCKER parameter (P-01, P-03) is MISSING. */
  readonly blockerCap: number;
  /**
   * Consecutive blocker rounds allowed before the user is asked to rewrite
   * the description instead of answering another blocker question (BUG-05).
   */
  readonly blockerMaxRounds: number;
  /** Hard ceiling on rounds per session; SessionSchema stores at most this many. */
  readonly maxTotalRounds: number;
  /** Asked when the model fails to produce a usable blocker question. */
  readonly blockerFallback: FallbackQuestion;
  /**
   * How the confidence score is blended from its components (ARCH-01).
   * They sum to 1; the GitHub bonus is added on top, then the cap applies.
   */
  readonly scoreWeights: {
    readonly coverage: number;
    readonly quality: number;
    readonly consistency: number;
  };
  /** Most the GitHub corroboration bonus can add to the score. */
  readonly githubBonusMax: number;
  /**
   * Modules that are standard for each of the blueprint's 9 domains
   * (blueprint step 07). A module on its domain's list is expected; one that
   * is merely a synonym of an entry counts for half.
   */
  readonly domainModules: Readonly<Record<string, readonly string[]>>;
  /** Names that mean the same module, for the half-credit match. */
  readonly moduleSynonyms: Readonly<Record<string, readonly string[]>>;
  /** How the per-module confidence is blended. They sum to 1. */
  readonly moduleWeights: {
    readonly paramSignal: number;
    readonly githubFreq: number;
    readonly templateMatch: number;
  };
  /** Above this a module is HIGH; at or below moduleLow it is LOW. */
  readonly moduleHigh: number;
  readonly moduleLow: number;
}

export const SCOPING: ScopingConfig = {
  parameters: [
    {
      id: "P-01",
      name: "Project Goal / Problem Statement",
      tier: "BLOCKER",
      weight: 5,
      description: "The core problem the software solves.",
    },
    {
      id: "P-02",
      name: "Target Users / Personas",
      tier: "HIGH",
      weight: 4,
      description: "Who uses the system and what roles they have.",
    },
    {
      id: "P-03",
      name: "Core Features / Functionality",
      tier: "BLOCKER",
      weight: 5,
      description: "What the system must actually do.",
    },
    {
      id: "P-04",
      name: "Technical Constraints / Stack Preferences",
      tier: "HIGH",
      weight: 3.5,
      description: "Required stack, platforms and existing systems.",
    },
    {
      id: "P-05",
      name: "Third-Party Integrations",
      tier: "MED",
      weight: 2.5,
      description: "External services such as payments, auth, messaging or CRMs.",
    },
    {
      id: "P-06",
      name: "Non-Functional Requirements",
      tier: "MED",
      weight: 2,
      description: "Performance, uptime, compliance, accessibility and retention.",
    },
    {
      id: "P-07",
      name: "Budget Range",
      tier: "MED",
      weight: 2,
      description: "The budget ceiling or range that constrains scope.",
    },
    {
      id: "P-08",
      name: "Delivery Timeline",
      tier: "MED",
      weight: 2,
      description: "When it must be live, MVP versus full launch.",
    },
    {
      id: "P-09",
      name: "Success Metrics / Definition of Done",
      tier: "LOW",
      weight: 1,
      description: "How success is measured: KPIs and acceptance criteria.",
    },
  ],
  stateMultipliers: {
    PRESENT: 1,
    PARTIAL_DEEP: 0.7,
    PARTIAL_THIN: 0.3,
    MISSING: 0,
  },
  confidenceThreshold: 70,
  maxRounds: 3,
  diminishingDelta: 4,
  criticalCap: 65,
  blockerCap: 40,
  blockerMaxRounds: 3,
  maxTotalRounds: 10,
  blockerFallback: {
    question: "What problem does this software solve?",
    options: [
      "Automate a manual process",
      "Replace an existing tool",
      "Connect two systems",
      "Sell a product or service to customers",
      "Give internal teams a better workflow",
      "Other (describe)",
    ],
  },
  scoreWeights: { coverage: 0.5, quality: 0.3, consistency: 0.2 },
  githubBonusMax: 5,
  domainModules: {
    saas: [
      "Auth",
      "Billing",
      "Dashboard",
      "Team Management",
      "Settings",
      "Notifications",
      "Admin Panel",
      "Onboarding",
      "API Keys",
    ],
    ecommerce: [
      "Auth",
      "Catalog",
      "Cart",
      "Checkout",
      "Payments",
      "Orders",
      "Inventory",
      "Shipping",
      "Reviews",
      "Admin Panel",
    ],
    marketplace: [
      "Auth",
      "Listings",
      "Search",
      "Checkout",
      "Payments",
      "Payouts",
      "Reviews",
      "Messaging",
      "Disputes",
      "Admin Panel",
    ],
    fintech: [
      "Auth",
      "KYC",
      "Accounts",
      "Payments",
      "Transactions",
      "Ledger",
      "Statements",
      "Compliance",
      "Notifications",
      "Admin Panel",
    ],
    edtech: [
      "Auth",
      "Courses",
      "Lessons",
      "Quizzes",
      "Progress Tracking",
      "Enrollment",
      "Payments",
      "Certificates",
      "Admin Panel",
    ],
    healthcare: [
      "Auth",
      "Patient Records",
      "Appointments",
      "Scheduling",
      "Messaging",
      "Billing",
      "Consent",
      "Audit Log",
      "Admin Panel",
    ],
    mobile: [
      "Auth",
      "Onboarding",
      "Profile",
      "Push Notifications",
      "Offline Sync",
      "Settings",
      "Feed",
      "Search",
    ],
    "internal-tools": [
      "Auth",
      "RBAC",
      "Dashboard",
      "Records",
      "Search",
      "Reporting",
      "Audit Log",
      "Settings",
      "Admin Panel",
    ],
    cms: [
      "Auth",
      "Content Editor",
      "Media Library",
      "Publishing",
      "Taxonomy",
      "Search",
      "Comments",
      "Analytics",
      "Admin Panel",
    ],
  },
  moduleSynonyms: {
    Auth: [
      "Authentication",
      "Sign-in",
      "Login",
      "Accounts",
      "User Accounts",
      "SSO",
      "Identity",
    ],
    Billing: ["Payments", "Subscriptions", "Invoicing", "Checkout"],
    Dashboard: ["Analytics", "Reporting", "Reports", "Insights"],
    Notifications: ["Alerts", "Email", "SMS", "Push Notifications", "Messaging"],
    "Admin Panel": ["Admin", "Back Office", "Management Console", "Settings"],
    Catalog: ["Products", "Listings", "Inventory"],
    Search: ["Discovery", "Filters", "Browse"],
    "Team Management": [
      "Teams",
      "Members",
      "Invitations",
      "RBAC",
      "Permissions",
      "Roles",
    ],
    "Progress Tracking": ["Progress", "Tracking", "Completion"],
    "Patient Records": ["Records", "EHR", "Charts"],
    Appointments: ["Scheduling", "Bookings", "Calendar"],
    Payouts: ["Disbursements", "Transfers", "Settlements"],
  },
  moduleWeights: { paramSignal: 0.45, githubFreq: 0.35, templateMatch: 0.2 },
  moduleHigh: 0.8,
  moduleLow: 0.55,
};

const WEIGHT_BY_ID = new Map<ParameterId, number>(
  SCOPING.parameters.map((p) => [p.id, p.weight]),
);

/** Weight of a parameter. Every ParameterId is configured above. */
export function parameterWeight(id: ParameterId): number {
  return WEIGHT_BY_ID.get(id) ?? 1;
}

/** Multiplier applied to a parameter's weight for a given state. */
export function stateMultiplier(state: ParameterState): number {
  return SCOPING.stateMultipliers[state];
}
