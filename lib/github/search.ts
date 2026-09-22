import "@/lib/server-only";
import { getOctokit, isRetryableOrRateLimited } from "@/lib/github/client";
import { RepoSlugSchema, type RepoSearchResult } from "@/lib/schemas/github";
import { stripHtml, truncateText } from "@/lib/security/sanitize";
import { GitHubError } from "@/lib/errors";
import { logger } from "@/lib/logger";

const README_MAX_CHARS = 8_000;
const SEARCH_LIMIT = 16;
const FOLDER_FETCH_MAX_FOLDERS = 12;

/**
 * Map a free-form Aureon domain label to a GitHub topic when one is widely
 * used. Topics are far more precise than keyword matches because they're
 * curated by repo owners.
 */
const DOMAIN_TO_TOPIC: Record<string, string> = {
  saas: "saas",
  "e-commerce": "ecommerce",
  ecommerce: "ecommerce",
  marketplace: "marketplace",
  fintech: "fintech",
  edtech: "education",
  healthcare: "healthcare",
  "mobile app": "mobile",
  "internal tool": "internal-tools",
  "content platform": "cms",
};

/**
 * Map common stack mentions in P-04 to GitHub `language:` qualifiers.
 * Generous matching — partial substring is enough.
 */
const STACK_TO_LANG: Array<{ match: RegExp; lang: string }> = [
  { match: /next\.?js|react|typescript|node|express|nest/i, lang: "typescript" },
  { match: /python|django|flask|fastapi/i, lang: "python" },
  { match: /rails|ruby/i, lang: "ruby" },
  { match: /go(lang)?|golang/i, lang: "go" },
  { match: /rust/i, lang: "rust" },
  { match: /java|spring|kotlin/i, lang: "java" },
  { match: /php|laravel|symfony/i, lang: "php" },
  { match: /\.net|c#|asp\.?net/i, lang: "c#" },
  { match: /swift|ios/i, lang: "swift" },
  { match: /android|kotlin/i, lang: "kotlin" },
];

const RECENCY_CUTOFF = "pushed:>2022-01-01";
const QUALITY_FILTERS = ["fork:false", "archived:false", "stars:>25"];

/**
 * Terms that appear in most application repositories but do little to
 * distinguish one product from another. They should not become the only
 * anchor of a GitHub search query.
 */
const GENERIC_FEATURE_TERMS = new Set([
  "account",
  "accounts",
  "admin",
  "application",
  "app",
  "auth",
  "authentication",
  "authorization",
  "feature",
  "features",
  "login",
  "management",
  "module",
  "modules",
  "platform",
  "role",
  "roles",
  "service",
  "system",
  "user",
  "users",
]);

export interface BuildQueryInput {
  domain: string;
  keywords: string[];
  /** Optional tech-stack hint, normally extraction.parameters[P-04].evidence */
  stackHint?: string | null;
}

/* ──────────────────────────────────────────────────────────────
 *  Multi-query generation
 * ────────────────────────────────────────────────────────────── */

interface NamedQuery {
  label: string;
  q: string;
}

/**
 * Generate up to 4 query variants — each emphasises a different angle.
 * The orchestrator runs them in parallel and merges with RRF.
 *
 * Repository search treats every unqualified word as required. Combining all
 * extracted modules therefore produces queries that almost never match a
 * real-world repository (for example, auth + seller + catalog + checkout +
 * payouts). Instead, search the domain/topic and the most distinctive feature
 * phrases independently, then use RRF and BM25 to keep only relevant repos.
 */
export function buildQueryVariants(input: BuildQueryInput): NamedQuery[] {
  const domainTerms = buildDomainTerms(input.domain);
  const topic = findTopic(input.domain);
  const lang = detectLanguage(input.stackHint ?? "");
  const featurePhrases = buildFeaturePhrases(input.keywords);
  const baseFilters = [...QUALITY_FILTERS, RECENCY_CUTOFF];
  const langFilter = lang ? [`language:${lang}`] : [];

  const variants: NamedQuery[] = [];
  const add = (label: string, terms: string[], includeSearchFields = true) => {
    if (variants.length >= 4 || (terms.length === 0 && !lang)) return;
    variants.push({
      label,
      q: [
        ...terms,
        ...langFilter,
        ...baseFilters,
        ...(includeSearchFields ? ["in:name,description,readme"] : []),
      ].join(" "),
    });
  };

  if (topic) {
    // A topic is owner-curated, so keep this query broad. Feature terms are
    // covered by separate queries below rather than making every term match.
    add("topic-broad", [`topic:${topic}`], false);
  }

  if (domainTerms[0]) add("domain-broad", [domainTerms[0]]);

  for (const [index, phrase] of featurePhrases.entries()) {
    add(`feature-${index + 1}`, phrase.split(" "));
  }

  // Inputs with no meaningful domain or feature phrase should still produce
  // a useful stack-only discovery query instead of silently skipping GitHub.
  if (variants.length === 0 && lang) add("stack-broad", []);

  return variants;
}

function normalizeSearchText(value: string): string {
  return (
    value
      // Split camelCase words ("InvoiceExport" → "Invoice Export") but not a
      // trailing capital or acronym ("SaaS", "PostgreSQL", "GraphQL").
      .replace(/([a-z])([A-Z][a-z])/g, "$1 $2")
      .toLowerCase()
      .replace(/[^a-z0-9 -]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function uniqueTerms(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function findTopic(domain: string): string | undefined {
  const normalized = normalizeSearchText(domain);
  const direct = DOMAIN_TO_TOPIC[normalized];
  if (direct) return direct;

  // LLMs often emit compound labels such as "ecommerce marketplace". Match
  // their recognizable parts rather than requiring an exact dictionary key.
  const compact = normalized.replace(/\s/g, "");
  const matchingKey = Object.keys(DOMAIN_TO_TOPIC)
    .sort((a, b) => b.length - a.length)
    .find((key) => compact.includes(key.replace(/[^a-z0-9]/g, "")));
  return matchingKey ? DOMAIN_TO_TOPIC[matchingKey] : undefined;
}

function buildDomainTerms(domain: string): string[] {
  const normalized = normalizeSearchText(domain);
  const compact = normalized.replace(/\s/g, "");
  const recognized: string[] = [];

  // Add back terms hidden in compound labels such as "ecommercemarketplace".
  if (compact.includes("marketplace")) recognized.push("marketplace");
  if (compact.includes("ecommerce")) recognized.push("ecommerce");
  if (compact.includes("fintech")) recognized.push("fintech");
  if (compact.includes("healthcare")) recognized.push("healthcare");
  if (compact.includes("education") || compact.includes("edtech"))
    recognized.push("education");

  const words = normalized.split(" ").filter((word) => word.length >= 3);
  return uniqueTerms([...recognized, ...words]).slice(0, 3);
}

function buildFeaturePhrases(keywords: string[]): string[] {
  const phrases = uniqueTerms(
    keywords
      .map(normalizeSearchText)
      .filter((phrase) => phrase.length >= 2 && phrase.length <= 60)
      .filter((phrase) =>
        phrase.split(" ").some((word) => !GENERIC_FEATURE_TERMS.has(word)),
      ),
  );

  return phrases
    .sort((a, b) => featureSpecificity(b) - featureSpecificity(a))
    .slice(0, 2);
}

function featureSpecificity(phrase: string): number {
  return phrase.split(" ").filter((word) => !GENERIC_FEATURE_TERMS.has(word)).length;
}

function detectLanguage(stackHint: string): string | null {
  const text = (stackHint ?? "").toLowerCase();
  if (!text) return null;
  for (const { match, lang } of STACK_TO_LANG) {
    if (match.test(text)) return lang;
  }
  return null;
}

/**
 * Backward-compat single-query builder kept for any callers that don't want
 * multi-query. Equivalent to the old `buildSearchQuery` shape.
 */
export function buildSearchQuery(input: BuildQueryInput): string {
  const variants = buildQueryVariants(input);
  return variants[0]?.q ?? "";
}

/* ──────────────────────────────────────────────────────────────
 *  Single-query execution
 * ────────────────────────────────────────────────────────────── */

async function runSearch(query: string): Promise<RepoSearchResult[]> {
  const octokit = getOctokit();
  const t0 = Date.now();
  const res = await octokit.search.repos({
    q: query,
    sort: "stars",
    order: "desc",
    per_page: SEARCH_LIMIT,
  });
  logger.info("github.search.completed", {
    durationMs: Date.now() - t0,
    query,
    total: res.data.total_count,
    returned: res.data.items.length,
  });

  const results: RepoSearchResult[] = [];
  for (const item of res.data.items) {
    if (item.fork) continue;
    if (item.archived) continue;
    if ((item.description ?? "").length < 8) continue;
    const slugCheck = RepoSlugSchema.safeParse(item.full_name);
    if (!slugCheck.success) continue;
    results.push({
      repo: slugCheck.data,
      url: item.html_url,
      description: truncateText(stripHtml(item.description ?? ""), 800),
      stars: item.stargazers_count,
    });
  }
  return results;
}

/* ──────────────────────────────────────────────────────────────
 *  Multi-query + RRF merge
 * ────────────────────────────────────────────────────────────── */

const RRF_K = 60; // standard RRF constant

interface RankedHit {
  result: RepoSearchResult;
  score: number;
}

/**
 * Reciprocal Rank Fusion: each repo's score is Σ 1/(K + rank) across the
 * queries it appears in. Repos that show up in multiple variants float to
 * the top — the multi-query equivalent of "high consensus".
 */
function rrfMerge(rankedLists: RepoSearchResult[][]): RankedHit[] {
  const acc = new Map<string, RankedHit>();
  for (const list of rankedLists) {
    list.forEach((r, i) => {
      const cur = acc.get(r.repo);
      const inc = 1 / (RRF_K + i + 1);
      if (cur) {
        cur.score += inc;
      } else {
        acc.set(r.repo, { result: r, score: inc });
      }
    });
  }
  return Array.from(acc.values()).sort((a, b) => b.score - a.score);
}

export interface SearchOutcome {
  query: string;
  /** Best query for cache-key purposes; first variant or fallback used. */
  results: RepoSearchResult[];
  /** Telemetry — how many queries fired, hits per query, etc. */
  variantsRun: Array<{ label: string; q: string; count: number }>;
}

export async function searchRepos(input: BuildQueryInput): Promise<SearchOutcome> {
  const variants = buildQueryVariants(input);
  if (variants.length === 0) {
    return { query: "", results: [], variantsRun: [] };
  }

  try {
    // Run all variants in parallel. GitHub allows concurrent search calls
    // up to ~30/min with a token, well within budget for 4 variants.
    const settled = await Promise.allSettled(variants.map((v) => runSearch(v.q)));

    const variantsRun: SearchOutcome["variantsRun"] = [];
    const lists: RepoSearchResult[][] = [];
    settled.forEach((s, i) => {
      const v = variants[i]!;
      if (s.status === "fulfilled") {
        lists.push(s.value);
        variantsRun.push({ label: v.label, q: v.q, count: s.value.length });
      } else {
        variantsRun.push({ label: v.label, q: v.q, count: 0 });
      }
    });

    let merged = rrfMerge(lists).map((h) => h.result);

    // If the recent, relevance-focused variants return too little, retry one
    // broad domain/feature query without a recency cutoff. This catches older
    // but mature public projects without making every primary search noisy.
    if (merged.length < 3) {
      const fallbackTerm =
        buildDomainTerms(input.domain)[0] ??
        buildFeaturePhrases(input.keywords)[0]?.split(" ")[0];
      if (fallbackTerm) {
        const looseQ = [
          fallbackTerm,
          "fork:false",
          "archived:false",
          "stars:>10",
          "in:name,description,readme",
        ].join(" ");
        try {
          const loose = await runSearch(looseQ);
          variantsRun.push({ label: "broad-fallback", q: looseQ, count: loose.length });
          const seen = new Set(merged.map((r) => r.repo));
          for (const r of loose) {
            if (!seen.has(r.repo)) merged.push(r);
          }
        } catch {
          /* swallow — primary results stand */
        }
      }
    }

    merged = merged.slice(0, SEARCH_LIMIT);
    const primaryQuery = variants[0]!.q;
    return { query: primaryQuery, results: merged, variantsRun };
  } catch (err) {
    if (isRetryableOrRateLimited(err)) {
      logger.warn("github.search.rate_limited_or_retryable");
      return { query: variants[0]!.q, results: [], variantsRun: [] };
    }
    const message = err instanceof Error ? err.message : "unknown error";
    logger.error("github.search.failure", { message });
    throw new GitHubError("GitHub search failed");
  }
}

/* ──────────────────────────────────────────────────────────────
 *  README + folder-tree fetch
 * ────────────────────────────────────────────────────────────── */

export async function fetchReadme(repo: string): Promise<string | null> {
  const slugCheck = RepoSlugSchema.safeParse(repo);
  if (!slugCheck.success) return null;
  const [owner, name] = slugCheck.data.split("/") as [string, string];

  const octokit = getOctokit();
  try {
    const res = await octokit.repos.getReadme({ owner, repo: name });
    const encoding = res.data.encoding;
    let raw = "";
    if (encoding === "base64") {
      raw = Buffer.from(res.data.content, "base64").toString("utf8");
    } else if (typeof res.data.content === "string") {
      raw = res.data.content;
    }
    return truncateText(stripHtml(raw), README_MAX_CHARS);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) return null;
    if (isRetryableOrRateLimited(err)) {
      logger.warn("github.readme.rate_limited", { repo });
      return null;
    }
    const message = err instanceof Error ? err.message : "unknown";
    logger.warn("github.readme.failure", { repo, message });
    return null;
  }
}

/**
 * Folder-tree mining. Hits the git/trees endpoint with `recursive=1` (single
 * call per repo, costs 1 of the 5000/hr quota when authed). Returns the
 * top-level folder names that look like module/feature directories.
 *
 * Filters out conventional non-module folders: `src`, `node_modules`,
 * `dist`, `build`, `public`, `tests`, `docs`, `.github`, etc.
 */
export async function fetchTopFolders(repo: string): Promise<string[]> {
  const slugCheck = RepoSlugSchema.safeParse(repo);
  if (!slugCheck.success) return [];
  const [owner, name] = slugCheck.data.split("/") as [string, string];

  const octokit = getOctokit();
  try {
    // Resolve default branch first.
    const repoMeta = await octokit.repos.get({ owner, repo: name });
    const branch = repoMeta.data.default_branch ?? "main";
    const tree = await octokit.git.getTree({
      owner,
      repo: name,
      tree_sha: branch,
      recursive: "1",
    });
    if (!tree.data.tree) return [];

    // Collect first-level folders (path with no slash) AND second-level
    // folders inside `src/`, `app/`, `apps/`, `packages/` (monorepo style).
    const candidates = new Set<string>();
    for (const entry of tree.data.tree) {
      if (entry.type !== "tree" || !entry.path) continue;
      const parts = entry.path.split("/");
      if (parts.length === 1) candidates.add(parts[0]!);
      else if (
        parts.length === 2 &&
        ["src", "app", "apps", "packages", "modules", "lib", "components"].includes(
          parts[0]!,
        )
      ) {
        candidates.add(parts[1]!);
      }
    }
    return Array.from(candidates)
      .filter(isLikelyModuleFolder)
      .map(toCanonicalModuleName)
      .filter((s, i, arr) => arr.indexOf(s) === i)
      .slice(0, FOLDER_FETCH_MAX_FOLDERS);
  } catch (err) {
    if (isRetryableOrRateLimited(err)) {
      logger.warn("github.tree.rate_limited", { repo });
      return [];
    }
    const message = err instanceof Error ? err.message : "unknown";
    logger.warn("github.tree.failure", { repo, message });
    return [];
  }
}

const NON_MODULE_FOLDER_RE = new RegExp(
  "^(node_modules|dist|build|out|coverage|public|static|assets|docs?|" +
    "examples?|tests?|test|__tests__|spec|specs|scripts|tools|tooling|" +
    "config|configs|\\.github|\\.vscode|\\.idea|\\.husky|\\.next|\\.cache|" +
    "vendor|fixtures|bin|i18n|locales?|translations?|migrations?|seeds?|" +
    "logs|tmp|temp|cypress|e2e|storybook|\\.storybook|infra|infrastructure|" +
    "deploy|deployment|ci|\\.ci|\\.gitlab-ci|\\.circleci|terraform|k8s|" +
    "kubernetes|helm|docker|workflows|hooks|css|sass|styles?|images?|" +
    "fonts|icons|svgs?|media|audio|video|content|data|db|sql|prisma|" +
    "drizzle|src|app|apps|packages|lib|libs|modules|components)$",
  "i",
);

function isLikelyModuleFolder(name: string): boolean {
  if (!name || name.length < 2 || name.length > 40) return false;
  if (name.startsWith(".")) return false;
  if (/[A-Z]/.test(name) && /[a-z]/.test(name)) {
    /* mixedCase / PascalCase often indicates a feature folder; keep */
  }
  return !NON_MODULE_FOLDER_RE.test(name);
}

function toCanonicalModuleName(folder: string): string {
  return folder
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => (w[0] ? w[0].toUpperCase() + w.slice(1) : ""))
    .join(" ");
}
