import { z } from "zod";

/**
 * GitHub repo slug validator. Used everywhere we accept "owner/name" before
 * making an API call — never pass a string to the GitHub client without
 * running it through this first to avoid path traversal / injection.
 */
export const RepoSlugSchema = z
  .string()
  .min(3)
  .max(140)
  .regex(/^[\w.-]+\/[\w.-]+$/, "Invalid repo slug");

export const RepoSearchResultSchema = z.object({
  repo: RepoSlugSchema,
  url: z.string().url(),
  description: z.string().max(800),
  stars: z.number().int().min(0),
  /** Owner-curated topics from the search result, used for BM25 ranking. */
  topics: z.array(z.string().max(50)).max(40).default([]),
  /** From the search result, so no extra repos.get call is needed. */
  default_branch: z.string().min(1).max(255).default("main"),
});
export type RepoSearchResult = z.infer<typeof RepoSearchResultSchema>;

export const GitHubMatchSchema = z.object({
  repo: RepoSlugSchema,
  url: z.string().url(),
  description: z.string().max(800),
  stars: z.number().int().min(0),
  similarity: z.number().min(0).max(1),
  modules_found: z.array(z.string().min(1).max(80)).max(60),
  /** Modules harvested from the repo's folder tree. */
  folders_found: z.array(z.string().min(1).max(80)).max(40).default([]),
  /** One-sentence rationale for why this repo is similar to the project. */
  why_relevant: z.string().max(280).default(""),
});
export type GitHubMatch = z.infer<typeof GitHubMatchSchema>;

export const QueryVariantTelemetrySchema = z.object({
  label: z.string().max(40),
  q: z.string().max(400),
  count: z.number().int().min(0),
});

export const GitHubEnrichmentSchema = z.object({
  matches: z.array(GitHubMatchSchema).max(8),
  /**
   * Similarity-weighted module frequency: each occurrence of a module in a
   * matched repo contributes its repo's similarity score, not 1.0.
   * Modules in highly-similar repos rank higher than ones in marginal
   * matches.
   */
  module_frequency: z.record(z.string().min(1).max(80), z.number()),
  /**
   * How many DIFFERENT matched repos mentioned each module. A module a
   * single repo invented cannot be added to the scope (SEC-04).
   */
  module_repos: z.record(z.string().min(1).max(80), z.number().int().min(0)).default({}),
  query_used: z.string().max(400),
  /** Telemetry: which query variants ran + how many hits each returned. */
  variants: z.array(QueryVariantTelemetrySchema).max(8).default([]),
});
export type GitHubEnrichment = z.infer<typeof GitHubEnrichmentSchema>;

/**
 * A module name mined from somebody else's README (SEC-04). READMEs are
 * untrusted text, so a name may only be a plain label — no punctuation to
 * smuggle instructions through, and short enough to be a name.
 */
export const ReadmeModuleNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9 &/-]+$/);

export const ExtractModulesToolOutputSchema = z.object({
  modules: z.array(z.string().min(1).max(80)).max(40),
  similarity_to_project: z.number().min(0).max(1),
  why_relevant: z.string().max(280).default(""),
});
export type ExtractModulesToolOutput = z.infer<typeof ExtractModulesToolOutputSchema>;
