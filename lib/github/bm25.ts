import "@/lib/server-only";

/**
 * Tiny BM25 / Okapi-style scorer used to pre-rank GitHub candidates before
 * the expensive per-README LLM call.
 *
 * Why: RRF returns 10 candidates ordered by query-overlap, but a project
 * about "FinTech invoicing" might rank "shopify-admin-template" first
 * because both have words like "dashboard". A quick BM25 pass over each
 * repo's combined description+name corpus, scored against the project
 * description, picks the 5 most lexically-relevant for Haiku to score.
 *
 * No external dependency — implementation is ~40 lines and is plenty
 * accurate for a 10-candidate corpus.
 */

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "for",
  "on",
  "with",
  "at",
  "by",
  "from",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "can",
  "this",
  "that",
  "these",
  "those",
  "i",
  "we",
  "you",
  "they",
  "it",
  "its",
  "their",
  "our",
  "your",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && t.length <= 30 && !STOP_WORDS.has(t));
}

interface Doc<T> {
  ref: T;
  tokens: string[];
  /** token → term frequency in this doc */
  tf: Map<string, number>;
}

function buildDocs<T>(items: T[], extract: (item: T) => string): Array<Doc<T>> {
  return items.map((ref) => {
    const tokens = tokenize(extract(ref));
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { ref, tokens, tf };
  });
}

/**
 * Rank `candidates` by BM25 against `query`. Returns the same items in
 * descending relevance order. Items with no overlap appear at the bottom
 * but still appear (so we never drop a candidate due to a 0 score).
 */
export function bm25Rank<T>(
  query: string,
  candidates: T[],
  extract: (item: T) => string,
  opts: { k1?: number; b?: number } = {},
): Array<{ item: T; score: number }> {
  if (candidates.length === 0) return [];
  const k1 = opts.k1 ?? 1.5;
  const b = opts.b ?? 0.75;

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return candidates.map((item) => ({ item, score: 0 }));
  }

  const docs = buildDocs(candidates, extract);
  const N = docs.length;
  const avgDl = docs.reduce((s, d) => s + d.tokens.length, 0) / N;

  // doc frequency per query token
  const df = new Map<string, number>();
  for (const t of new Set(queryTokens)) {
    let n = 0;
    for (const d of docs) if (d.tf.has(t)) n++;
    df.set(t, n);
  }

  const scored = docs.map((d) => {
    let score = 0;
    for (const t of queryTokens) {
      const f = d.tf.get(t);
      if (!f) continue;
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const dl = d.tokens.length;
      const tfNorm = (f * (k1 + 1)) / (f + k1 * (1 - b + (b * dl) / (avgDl || 1)));
      score += idf * tfNorm;
    }
    return { item: d.ref, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}
