import { z } from "zod";
import { ModuleSizeSchema } from "@/lib/schemas/extraction";

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
});
export type ClientModule = z.infer<typeof ClientModuleSchema>;

export const MilestoneSchema = z.object({
  phase: z.string().min(1).max(40), // e.g. "Month 1", "Sprint 1-2"
  name: z.string().min(1).max(120),
  deliverables: z.array(z.string().min(1).max(200)).min(1).max(12),
});
export type Milestone = z.infer<typeof MilestoneSchema>;

export const ConfidenceBadgeSchema = z.object({
  score: z.number().int().min(0).max(100),
  breakdown: z.object({
    coverage: z.number().int().min(0).max(100),
    llm_quality: z.number().int().min(0).max(100),
    github_validation: z.number().int().min(0).max(100),
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
export type DatabaseTable = z.infer<typeof DatabaseTableSchema>;

export const AuthModelSchema = z.object({
  roles: z.array(z.string().min(1).max(40)).min(1).max(12),
  // role → allowed actions / scopes (free-form, but bounded).
  permissions_matrix: z.record(
    z.string().min(1).max(40),
    z.array(z.string().min(1).max(160)).max(40),
  ),
});
export type AuthModel = z.infer<typeof AuthModelSchema>;

export const SprintSchema = z.object({
  sprint: z.string().min(1).max(40), // "Sprint 1", "Week 3-4"
  focus: z.string().min(1).max(200),
  story_points: z.number().int().min(0).max(200),
  modules: z.array(z.string().min(1).max(80)).max(20),
});
export type Sprint = z.infer<typeof SprintSchema>;

export const TestingStrategyRowSchema = z.object({
  module: z.string().min(1).max(80),
  unit: z.string().min(1).max(200),
  integration: z.string().min(1).max(200),
  e2e: z.string().min(1).max(200),
});
export type TestingStrategyRow = z.infer<typeof TestingStrategyRowSchema>;

export const RiskSeveritySchema = z.enum(["CRITICAL", "WARNING", "NOTE"]);
export type RiskSeverity = z.infer<typeof RiskSeveritySchema>;

export const RiskSchema = z.object({
  severity: RiskSeveritySchema,
  description: z.string().min(1).max(400),
});
export type Risk = z.infer<typeof RiskSchema>;

export const GitHubReferenceSchema = z.object({
  repo: z.string().min(1).max(140),
  url: z.string().url(),
  why_relevant: z.string().min(1).max(300),
});
export type GitHubReference = z.infer<typeof GitHubReferenceSchema>;

export const EffortSummarySchema = z.object({
  total_sprints: z.number().int().min(1).max(60),
  team_size: z.number().int().min(1).max(30),
  confidence_band: z.string().min(1).max(60),
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
  github_references: z.array(GitHubReferenceSchema).max(10),
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
export type FinalizeRequest = z.infer<typeof FinalizeRequestSchema>;
