import "@/lib/server-only";
import {
  buildQueryVariants,
  fetchReadme,
  fetchRootTree,
  fetchSourceFolders,
  searchRepos,
  toModuleFolders,
  type BuildQueryInput,
} from "@/lib/github/search";
import { extractModulesFromReadme } from "@/lib/github/extract-modules";
import { bm25Rank } from "@/lib/github/bm25";
import { gitHubRequestsSent, withGitHubBudget } from "@/lib/github/client";
import { cacheGet, cacheSet, hashKey } from "@/lib/storage/cache";
import { canonicalModuleKey } from "@/lib/pipeline/merge";
import {
  GitHubEnrichmentSchema,
  type ExtractModulesToolOutput,
  type GitHubEnrichment,
  type GitHubMatch,
} from "@/lib/schemas/github";
import type { ExtractionResult } from "@/lib/schemas/extraction";
import { BudgetExceededError } from "@/lib/errors";
import { logger } from "@/lib/logger";

const MAX_PARALLEL_FETCHES = 6;
/** How many of the BM25-ranked candidates get an LLM similarity score. */
const LLM_SCORED_MATCHES = 6;
/**
 * Total matches kept (LLM-scored + folder-only references). Only this many
 * top BM25 candidates get their README and tree fetched (PERF-01).
 */
const TOTAL_MATCHES = 8;
const TOP_N_KEYWORDS = 5;
/**
 * GitHub requests one enrichment may send: up to 5 searches (4 variants + 1
 * fallback), README + root tree for 8 repos (16), and 5 src/ or app/ trees.
 */
export const GITHUB_REQUEST_BUDGET = 26;
/** Enrichments are cached per query-variant set for a day. */
const ENRICHMENT_CACHE_TTL_SECONDS = 24 * 60 * 60;

/**
 * Most a single repo can contribute to a module's weight (SEC-04). Below the
 * threshold a new module needs, so one repo — or one injected README — can
 * never add a module on its own.
 */
const MAX_REPO_WEIGHT = 0.8;

const EMPTY_ENRICHMENT: GitHubEnrichment = {
  matches: [],
  module_frequency: {},
  module_repos: {},
  query_used: "",
  variants: [],
};

function topKeywordsFromExtraction(extraction: ExtractionResult): string[] {
  const tokens: string[] = [];
  for (const m of extraction.modules) tokens.push(m.name);
  for (const p of extraction.parameters) {
    if (p.id === "P-03" && p.evidence) {
      for (const word of p.evidence.split(/[^a-zA-Z0-9]+/)) {
        if (word.length >= 4) tokens.push(word);
      }
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= TOP_N_KEYWORDS) break;
  }
  return out;
}

function stackHintFromExtraction(extraction: ExtractionResult): string | null {
  const p04 = extraction.parameters.find((p) => p.id === "P-04");
  return p04?.evidence ?? null;
}

function fulfilledValues<R>(settled: Array<PromiseSettledResult<R>>): R[] {
  return settled
    .filter((r): r is PromiseFulfilledResult<R> => r.status === "fulfilled")
    .map((r) => r.value);
}

/**
 * Bounded-concurrency mapper. Same as Promise.allSettled but caps the number
 * of in-flight tasks so we don't blast the GitHub API.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let cursor = 0;
  const workers: Array<Promise<void>> = [];
  const worker = async (): Promise<void> => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        const value = await fn(items[i] as T, i);
        results[i] = { status: "fulfilled", value };
      } catch (err) {
        results[i] = { status: "rejected", reason: err };
      }
    }
  };
  for (let w = 0; w < Math.min(limit, items.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

/**
 * GitHub enrichment for one extraction. The whole result is cached in Redis
 * for 24 h, keyed by a hash of the query variants, so a repeat of the same
 * searches costs no GitHub requests and no README LLM calls. Each run is held
 * to GITHUB_REQUEST_BUDGET requests, counted by an Octokit hook.
 */
export async function enrichWithGitHub(
  extraction: ExtractionResult,
  rawText: string,
): Promise<GitHubEnrichment> {
  const queryInput: BuildQueryInput = {
    domain: extraction.domain,
    keywords: topKeywordsFromExtraction(extraction),
    stackHint: stackHintFromExtraction(extraction),
  };
  const variants = buildQueryVariants(queryInput);
  const cacheKey = `scopeai:gh:${hashKey(JSON.stringify(variants))}`;

  if (variants.length > 0) {
    const t0 = Date.now();
    const cached = GitHubEnrichmentSchema.safeParse(await cacheGet<unknown>(cacheKey));
    if (cached.success) {
      logger.info("github.enrich.cache_hit", { durationMs: Date.now() - t0 });
      return cached.data;
    }
  }

  const { result } = await withGitHubBudget(GITHUB_REQUEST_BUDGET, () =>
    enrichUncached(extraction, rawText, queryInput),
  );
  // Empty results are not cached: they are usually a GitHub hiccup.
  if (result.matches.length > 0) {
    await cacheSet(cacheKey, result, ENRICHMENT_CACHE_TTL_SECONDS);
  }
  return result;
}

async function enrichUncached(
  extraction: ExtractionResult,
  rawText: string,
  queryInput: BuildQueryInput,
): Promise<GitHubEnrichment> {
  const t0 = Date.now();
  const search = await searchRepos(queryInput);

  if (search.results.length === 0) {
    logger.info("github.enrich.no_results", {
      query: search.query,
      variantsRun: search.variantsRun.length,
      githubRequests: gitHubRequestsSent(),
    });
    return {
      ...EMPTY_ENRICHMENT,
      query_used: search.query,
      variants: search.variantsRun,
    };
  }

  // BM25 pre-ranking on what the search already returned (name +
  // description + topics), BEFORE fetching anything else: only the top
  // TOTAL_MATCHES candidates cost README and tree requests (PERF-01).
  const projectQuery = `${rawText} ${extraction.domain} ${extraction.modules
    .map((m) => m.name)
    .join(" ")}`;
  const candidates = bm25Rank(
    projectQuery,
    search.results,
    (r) => `${r.repo.split("/")[1] ?? r.repo} ${r.description} ${r.topics.join(" ")}`,
  )
    .map((b) => b.item)
    .slice(0, TOTAL_MATCHES);

  // README + non-recursive root tree per candidate (2 requests each).
  const rootFetches = fulfilledValues(
    await mapWithConcurrency(candidates, MAX_PARALLEL_FETCHES, async (repo) => {
      const [readme, root] = await Promise.all([
        fetchReadme(repo.repo),
        fetchRootTree(repo.repo, repo.default_branch),
      ]);
      return { repo, readme, root };
    }),
  );
  // Then one call for src/ or app/ where present, in rank order, while the
  // request budget lasts.
  const fetched = fulfilledValues(
    await mapWithConcurrency(
      rootFetches,
      MAX_PARALLEL_FETCHES,
      async ({ repo, readme, root }) => {
        const source = root?.sourceTreeSha
          ? await fetchSourceFolders(repo.repo, root.sourceTreeSha)
          : [];
        const folders = toModuleFolders([...(root?.folders ?? []), ...source]);
        return { repo, readme, folders };
      },
    ),
  );

  // Per-README module extraction (Haiku), in parallel. The first
  // LLM_SCORED_MATCHES candidates with a README get a full LLM similarity +
  // module extract. The rest are kept as folder-only references: no LLM
  // call, but their mined folders still feed module_frequency at a small
  // weight and they appear in the engineer-doc GitHub references for breadth.
  const projectDescription = `${rawText}\n\nDomain: ${extraction.domain}`;
  const toScore = fetched.filter((v) => v.readme).slice(0, LLM_SCORED_MATCHES);
  const scored = await mapWithConcurrency(toScore, LLM_SCORED_MATCHES, (v) =>
    extractModulesFromReadme(projectDescription, v.readme ?? ""),
  );
  const scores = new Map<string, ExtractModulesToolOutput | null>();
  scored.forEach((settled, i) => {
    const repo = toScore[i]!.repo.repo;
    if (settled.status === "fulfilled") {
      scores.set(repo, settled.value);
      return;
    }
    // An exhausted AI budget is fatal for the round, not a GitHub hiccup.
    if (settled.reason instanceof BudgetExceededError) throw settled.reason;
    scores.set(repo, null);
  });

  const enriched: GitHubMatch[] = [];
  for (const { repo, folders } of fetched) {
    let modules_found: string[] = [];
    let similarity = 0;
    let why_relevant = "";

    if (scores.has(repo.repo)) {
      const out = scores.get(repo.repo);
      if (out) {
        modules_found = out.modules;
        similarity = out.similarity_to_project;
        why_relevant = out.why_relevant;
      }
    } else if (folders.length > 0) {
      // Folder-only reference: not LLM-scored, but still useful breadth.
      why_relevant = "Folder structure mined for module patterns (not deep-scored)";
    } else {
      continue; // nothing usable from this repo — drop it
    }

    enriched.push({
      repo: repo.repo,
      url: repo.url,
      description: repo.description,
      stars: repo.stars,
      similarity,
      modules_found,
      folders_found: folders,
      why_relevant,
    });

    if (enriched.length >= TOTAL_MATCHES) break;
  }

  // LLM-scored matches first (by similarity), then folder-only references
  // (by folder coverage) so the strongest signals lead.
  enriched.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    return b.folders_found.length - a.folders_found.length;
  });
  const topMatches = enriched.slice(0, TOTAL_MATCHES);

  // Similarity-weighted module frequency. Each occurrence contributes the
  // matching repo's similarity score (clamped to >= 0.1 so even un-scored
  // hits register a small signal). Modules from highly-similar repos rank
  // far above modules from marginal ones.
  const frequency: Record<string, number> = {};
  const repoCount: Record<string, number> = {};
  const canonicalNameByKey = new Map<string, string>();

  for (const m of topMatches) {
    const weight = Math.min(MAX_REPO_WEIGHT, Math.max(0.1, m.similarity));
    const seenInRepo = new Set<string>();
    const allModules = [...m.modules_found, ...m.folders_found];
    for (const mod of allModules) {
      const k = canonicalModuleKey(mod);
      if (!k || seenInRepo.has(k)) continue;
      seenInRepo.add(k);
      // Keep the first (canonical) name we encounter, but accumulate weight.
      if (!canonicalNameByKey.has(k)) canonicalNameByKey.set(k, mod);
      const display = canonicalNameByKey.get(k)!;
      frequency[display] = (frequency[display] ?? 0) + weight;
      repoCount[display] = (repoCount[display] ?? 0) + 1;
    }
  }

  // Round to 2 decimals so JSON stays compact.
  for (const k of Object.keys(frequency)) {
    frequency[k] = Math.round((frequency[k] ?? 0) * 100) / 100;
  }

  const result: GitHubEnrichment = {
    matches: topMatches,
    module_frequency: frequency,
    module_repos: repoCount,
    query_used: search.query,
    variants: search.variantsRun,
  };

  logger.info("github.enrich.completed", {
    durationMs: Date.now() - t0,
    githubRequests: gitHubRequestsSent(),
    reposSearched: search.results.length,
    variantsRun: search.variantsRun.length,
    readmesFetched: fetched.filter((r) => r.readme).length,
    foldersFetched: fetched.filter((r) => r.folders.length > 0).length,
    llmCallsUsed: toScore.length,
    topMatchesCount: topMatches.length,
    distinctModules: Object.keys(frequency).length,
    avgSimilarity:
      topMatches.length > 0
        ? Math.round(
            (topMatches.reduce((s, m) => s + m.similarity, 0) / topMatches.length) * 100,
          ) / 100
        : 0,
  });

  const validated = GitHubEnrichmentSchema.safeParse(result);
  if (!validated.success) {
    logger.error("github.enrich.zod_failure", {
      issues: validated.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    });
    return {
      ...EMPTY_ENRICHMENT,
      query_used: search.query,
      variants: search.variantsRun,
    };
  }
  return validated.data;
}
