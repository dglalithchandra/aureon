import { z } from "zod";
import { ModuleSizeSchema } from "@/lib/schemas/extraction";
import { GitHubUrlSchema, RepoLinkSchema } from "@/lib/schemas/github";

/**
 * Two-stage output schemas. Both `client` and `engineer` are produced by
 * separate LLM calls (parallel) so they can be tuned independently — the
 * client view is plain English, the engineer view is precise and concrete.
 *
 * Every string the LLM produces is bounded so a misbehaving model cannot
 * blow up the renderer or PDF export.
 */

/* ──────────────────────────────────────────────────────────────
 *  Client view
 * ────────────────────────────────────────────────────────────── */

export const ClientModuleSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(400),
  size: ModuleSizeSchema,
  github_validated: z.boolean(),
  /** Per-module confidence 0-1, filled in by the server (blueprint step 07). */
  confidence: z.number().min(0).max(1).nullable().default(null),
  /** Matched repos that named this module, for "Seen in N similar projects". */
  seen_in: z.array(RepoLinkSchema).max(8).default([]),
});
export type ClientModule = z.infer<typeof ClientModuleSchema>;

export const MilestoneSchema = z.object({
  phase: z.string().min(1).max(40), // e.g. "Month 1", "Sprint 1-2"
  name: z.string().min(1).max(120),
  deliverables: z.array(z.string().min(1).max(200)).min(1).max(12),
});
export type Milestone = z.infer<typeof MilestoneSchema>;

/**
 * The score and the components behind it (ARCH-01). Every field is computed
 * on the server by lib/scoring/confidence.ts; whatever the model writes here
 * is replaced. The components default so documents written before this
 * breakdown existed still load.
 */
export const ConfidenceBadgeSchema = z.object({
  score: z.number().int().min(0).max(100),
  breakdown: z.object({
    /** Weighted completeness of the 9 parameters. */
    coverage: z.number().int().min(0).max(100),
    /** The model's clarity read — "AI clarity read" in the UI. */
    ai_clarity: z.number().int().min(0).max(100).default(0),
    /** How closely coverage and the clarity read agree. */
    consistency: z.number().int().min(0).max(100).default(0),
    /** Corroboration from similar public repos, at most SCOPING.githubBonusMax. */
    github_bonus: z.number().int().min(0).max(100).default(0),
    /** The ceiling that applied: 40, 65, or 100 when none did. */
    cap_applied: z.number().int().min(0).max(100).default(100),
  }),
});
export type ConfidenceBadge = z.infer<typeof ConfidenceBadgeSchema>;

export const ClientViewSchema = z.object({
  project_summary: z.string().min(20).max(1_000),
  modules: z.array(ClientModuleSchema).min(1).max(40),
  milestones: z.array(MilestoneSchema).min(1).max(8),
  assumptions: z.array(z.string().min(1).max(400)).max(40),
  open_items: z.array(z.string().min(1).max(400)).max(40),
  confidence_badge: ConfidenceBadgeSchema,
});
export type ClientView = z.infer<typeof ClientViewSchema>;

/* ──────────────────────────────────────────────────────────────
 *  Engineer view
 * ────────────────────────────────────────────────────────────── */

export const EngineerModuleRowSchema = z.object({
  name: z.string().min(1).max(80),
  /** Per-module confidence 0-1, filled in by the server (blueprint step 07). */
  confidence: z.number().min(0).max(1).nullable().default(null),
  tech_stack: z.array(z.string().min(1).max(60)).min(1).max(12),
  size: ModuleSizeSchema,
  dependencies: z.array(z.string().min(1).max(80)).max(20),
  api_endpoints: z.array(z.string().min(1).max(160)).max(40),
  notes: z.string().max(400),
});
export type EngineerModuleRow = z.infer<typeof EngineerModuleRowSchema>;

export const DatabaseTableSchema = z.object({
  table: z.string().min(1).max(60),
  fields: z.array(z.string().min(1).max(120)).min(1).max(40),
  relations: z.array(z.string().min(1).max(160)).max(20),
});

export const AuthModelSchema = z.object({
  roles: z.array(z.string().min(1).max(40)).min(1).max(12),
  // role → allowed actions / scopes (free-form, but bounded).
  permissions_matrix: z.record(
    z.string().min(1).max(40),
    z.array(z.string().min(1).max(160)).max(40),
  ),
});

export const SprintSchema = z.object({
  sprint: z.string().min(1).max(40), // "Sprint 1", "Week 3-4"
  focus: z.string().min(1).max(200),
  story_points: z.number().int().min(0).max(200),
  modules: z.array(z.string().min(1).max(80)).max(20),
});

export const TestingStrategyRowSchema = z.object({
  module: z.string().min(1).max(80),
  unit: z.string().min(1).max(200),
  integration: z.string().min(1).max(200),
  e2e: z.string().min(1).max(200),
});

export const RiskSeveritySchema = z.enum(["CRITICAL", "WARNING", "NOTE"]);
export type RiskSeverity = z.infer<typeof RiskSeveritySchema>;

/**
 * One risk. `rule_id` names the rule in lib/scoring/risk.ts that fired;
 * "model" marks one the finalize model added on top. The severity and the
 * rule set are computed on the server (blueprint step 09) — the model may
 * only rewrite the wording. Older documents default to "model".
 */
export const RiskSchema = z.object({
  severity: RiskSeveritySchema,
  description: z.string().min(1).max(400),
  rule_id: z.string().min(1).max(40).default("model").catch("model"),
});
export type Risk = z.infer<typeof RiskSchema>;

/**
 * A reference to a real repository. Built on the server from the round's
 * GitHub matches (GOAL-02) — the model used to write these, and invented
 * repos and "javascript:" URLs got through (SEC-05).
 */
export const GitHubReferenceSchema = z.object({
  repo: z.string().min(1).max(140),
  url: GitHubUrlSchema,
  why_relevant: z.string().min(1).max(300),
});

export type GitHubReference = z.infer<typeof GitHubReferenceSchema>;

/** One module's contribution to the estimate, for "How we estimated this". */
export const EffortBasisSchema = z.object({
  name: z.string().min(1).max(80),
  size: ModuleSizeSchema,
  /** Points after the domain multiplier. */
  points: z.number().int().min(0).max(500),
});
export type EffortBasis = z.infer<typeof EffortBasisSchema>;

/**
 * The estimate. Every number here is computed by lib/scoring/effort.ts
 * (blueprint step 10), never taken from the model. The fields added after
 * the first release default and `.catch`, so documents stored before the
 * effort engine existed still load.
 */
export const EffortSummarySchema = z.object({
  total_sprints: z.number().int().min(1).max(60),
  team_size: z.number().int().min(1).max(30),
  confidence_band: z.string().min(1).max(60),
  /** Σ module points after the domain multiplier. */
  total_points: z.number().int().min(0).max(10_000).default(0).catch(0),
  /** Story points per two-week sprint for this team size. */
  velocity: z.number().int().min(1).max(200).default(26).catch(26),
  domain_multiplier: z.number().min(0.5).max(3).default(1).catch(1),
  /** False when the team size is the configured default, not a stated one. */
  team_size_stated: z.boolean().default(false).catch(false),
  basis: z.array(EffortBasisSchema).max(40).default([]).catch([]),
});
export type EffortSummary = z.infer<typeof EffortSummarySchema>;

export const EngineerViewSchema = z.object({
  module_table: z.array(EngineerModuleRowSchema).min(1).max(40),
  build_order: z.array(z.string().min(1).max(80)).min(1).max(40),
  database_sketch: z.array(DatabaseTableSchema).max(40),
  auth_model: AuthModelSchema,
  third_party_checklist: z.array(z.string().min(1).max(160)).max(30),
  sprint_breakdown: z.array(SprintSchema).min(1).max(20),
  testing_strategy: z.array(TestingStrategyRowSchema).max(40),
  security_per_module: z.record(
    z.string().min(1).max(80),
    z.array(z.string().min(1).max(200)).max(20),
  ),
  risks: z.array(RiskSchema).max(40),
  // The model no longer sends these; the server fills them in. Older
  // documents that stored something unusable fall back to an empty list.
  github_references: z.array(GitHubReferenceSchema).max(5).default([]).catch([]),
  effort_summary: EffortSummarySchema,
});
export type EngineerView = z.infer<typeof EngineerViewSchema>;

/* ──────────────────────────────────────────────────────────────
 *  Combined
 * ────────────────────────────────────────────────────────────── */

export const FinalOutputSchema = z.object({
  client: ClientViewSchema,
  engineer: EngineerViewSchema,
});
export type FinalOutput = z.infer<typeof FinalOutputSchema>;

export const FinalizeRequestSchema = z.object({
  sessionId: z.string().uuid(),
  override: z.boolean().default(false),
});
