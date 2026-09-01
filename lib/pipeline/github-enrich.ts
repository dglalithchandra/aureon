import "@/lib/server-only";
import {
  fetchReadme,
  fetchTopFolders,
  searchRepos,
  type BuildQueryInput,
} from "@/lib/github/search";
import { extractModulesFromReadme } from "@/lib/github/extract-modules";
import { bm25Rank } from "@/lib/github/bm25";
import {
  GitHubEnrichmentSchema,
  type GitHubEnrichment,
  type GitHubMatch,
} from "@/lib/schemas/github";
import type { ExtractionResult } from "@/lib/schemas/extraction";
import { logger } from "@/lib/logger";

const MAX_PARALLEL_FETCHES = 6;
/** How many of the BM25-ranked candidates get an LLM similarity score. */
const LLM_SCORED_MATCHES = 6;
/** Total matches kept (LLM-scored + folder-only references). */
const TOTAL_MATCHES = 8;
const TOP_N_KEYWORDS = 5;

const EMPTY_ENRICHMENT: GitHubEnrichment = {
  matches: [],
  module_frequency: {},
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
 * Canonical-ish module key for similarity-weighted aggregation. Lowercases,
 * strips non-alphanum, collapses common plural "s" suffix.
 */
function moduleKey(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return base.endsWith("s") && base.length > 3 ? base.slice(0, -1) : base;
}

export async function enrichWithGitHub(
  extraction: ExtractionResult,
  rawText: string,
): Promise<GitHubEnrichment> {
  const queryInput: BuildQueryInput = {
    domain: extraction.domain,
    keywords: topKeywordsFromExtraction(extraction),
    stackHint: stackHintFromExtraction(extraction),
  };

  const t0 = Date.now();
  const search = await searchRepos(queryInput);

  if (search.results.length === 0) {
    logger.info("github.enrich.no_results", {
      query: search.query,
      variantsRun: search.variantsRun.length,
    });
    return {
      ...EMPTY_ENRICHMENT,
      query_used: search.query,
      variants: search.variantsRun,
    };
  }

  // Fetch README + folder tree in parallel for each candidate. Folder tree
  // is a single GET tree?recursive=1 call per repo — costs 1 from the 5000/hr
  // quota. Both calls are independent so we use Promise.all per repo.
  const fetched = await mapWithConcurrency(
    search.results,
    MAX_PARALLEL_FETCHES,
    async (r) => {
      const [readme, folders] = await Promise.all([
        fetchReadme(r.repo),
        fetchTopFolders(r.repo),
      ]);
      return { repo: r, readme, folders };
    },
  );

  // BM25 pre-ranking: score every fetched candidate against the project text
  // using local lexical overlap, then send the *top 5* to Haiku — not just
  // the first 5 from RRF order. This typically surfaces 1-2 better matches
  // (e.g. a niche-domain repo that ranked low on stars but has high feature
  // overlap with the project description).
  const projectQuery = `${rawText} ${extraction.domain} ${extraction.modules
    .map((m) => m.name)
    .join(" ")}`;
  const fetchedSuccessful = fetched
    .filter(
      (r): r is Extract<typeof r, { status: "fulfilled" }> =>
        r.status === "fulfilled",
    )
    .map((r) => r.value);

  const bm25Ordered = bm25Rank(
    projectQuery,
    fetchedSuccessful,
    (item) =>
      `${item.repo.repo} ${item.repo.description} ${item.readme ?? ""} ${item.folders.join(" ")}`,
  ).map((b) => b.item);

  // Per-README module extraction (Haiku). The top LLM_SCORED_MATCHES
  // BM25-ranked candidates get a full LLM similarity + module extract.
  // The next few are kept as folder-only references: no LLM call, but their
  // mined folders still feed module_frequency at a small weight and they
  // appear in the engineer-doc GitHub references for breadth.
  const projectDescription = `${rawText}\n\nDomain: ${extraction.domain}`;
  const enriched: GitHubMatch[] = [];
  let llmCalls = 0;

  for (const value of bm25Ordered) {
    const { repo, readme, folders } = value;

    let modules_found: string[] = [];
    let similarity = 0;
    let why_relevant = "";

    if (readme && llmCalls < LLM_SCORED_MATCHES) {
      const out = await extractModulesFromReadme(projectDescription, readme);
      llmCalls++;
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
  const canonicalNameByKey = new Map<string, string>();

  for (const m of topMatches) {
    const weight = Math.max(0.1, m.similarity);
    const seenInRepo = new Set<string>();
    const allModules = [...m.modules_found, ...m.folders_found];
    for (const mod of allModules) {
      const k = moduleKey(mod);
      if (!k || seenInRepo.has(k)) continue;
      seenInRepo.add(k);
      // Keep the first (canonical) name we encounter, but accumulate weight.
      if (!canonicalNameByKey.has(k)) canonicalNameByKey.set(k, mod);
      const display = canonicalNameByKey.get(k)!;
      frequency[display] = (frequency[display] ?? 0) + weight;
    }
  }

  // Round to 2 decimals so JSON stays compact.
  for (const k of Object.keys(frequency)) {
    frequency[k] = Math.round((frequency[k] ?? 0) * 100) / 100;
  }

  const result: GitHubEnrichment = {
    matches: topMatches,
    module_frequency: frequency,
    query_used: search.query,
    variants: search.variantsRun,
  };

  logger.info("github.enrich.completed", {
    durationMs: Date.now() - t0,
    reposSearched: search.results.length,
    variantsRun: search.variantsRun.length,
    readmesFetched: fetched.filter(
      (r) => r.status === "fulfilled" && r.value.readme,
    ).length,
    foldersFetched: fetched.filter(
      (r) => r.status === "fulfilled" && r.value.folders.length > 0,
    ).length,
    llmCallsUsed: llmCalls,
    topMatchesCount: topMatches.length,
    distinctModules: Object.keys(frequency).length,
    avgSimilarity:
      topMatches.length > 0
        ? Math.round(
            (topMatches.reduce((s, m) => s + m.similarity, 0) /
              topMatches.length) *
              100,
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
