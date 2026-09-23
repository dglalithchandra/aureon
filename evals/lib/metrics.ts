import type { ParameterState } from "@/lib/schemas/extraction";
import { SCOPING } from "@/lib/config/scoping";
import { canonicalModuleKey } from "@/lib/scoring/module-name";

/**
 * The maths behind the report. Pure functions, no model calls, so
 * tests/unit/evals-metrics.test.ts can check every number the report prints.
 */

/** Ordered weakest to strongest — "within one level" is a step on this ladder. */
export const STATE_LADDER: readonly ParameterState[] = [
  "MISSING",
  "PARTIAL_THIN",
  "PARTIAL_DEEP",
  "PRESENT",
];

/** How many levels apart two states are, or null if either is unrecognised. */
export function stateDistance(a: string, b: string): number | null {
  const i = STATE_LADDER.indexOf(a as ParameterState);
  const j = STATE_LADDER.indexOf(b as ParameterState);
  if (i < 0 || j < 0) return null;
  return Math.abs(i - j);
}

/**
 * The nine blueprint domains, and the words that mean each of them. The model
 * writes the domain as free text ("B2B SaaS analytics", "E-Commerce store"),
 * so both sides are reduced to a family before they are compared.
 */
const DOMAIN_FAMILIES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["marketplace", ["marketplace", "multivendor", "twosided", "gig"]],
  ["ecommerce", ["ecommerce", "commerce", "retail", "shop", "shopping", "store", "d2c"]],
  [
    "fintech",
    ["fintech", "finance", "financial", "banking", "lending", "payments", "accounting"],
  ],
  [
    "edtech",
    ["edtech", "education", "educational", "learning", "lms", "school", "tutoring"],
  ],
  [
    "healthcare",
    ["healthcare", "health", "medical", "clinic", "clinical", "patient", "telehealth"],
  ],
  [
    "internal-tools",
    ["internal", "operations", "ops", "backoffice", "logistics", "dispatch", "erp"],
  ],
  ["cms", ["cms", "content", "publishing", "editorial", "media", "blog", "news"]],
  ["mobile", ["mobile", "android", "ios"]],
  ["saas", ["saas", "b2b", "subscription", "platform"]],
];

/**
 * The family a domain label belongs to, or null when nothing matches. Order
 * matters: "mobile marketplace" is a marketplace and "SaaS platform" is the
 * catch-all, so both are tried after the more specific families.
 *
 * A family word matches a whole word of the label, or part of one when the
 * word is long enough to be unambiguous ("eCommerce" → commerce).
 */
export function domainFamily(label: string): string | null {
  const tokens = label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  for (const [family, words] of DOMAIN_FAMILIES) {
    for (const word of words) {
      const hit = tokens.some(
        (token) =>
          token === word ||
          `${token}s` === word ||
          (word.length >= 6 && token.includes(word)),
      );
      if (hit) return family;
    }
  }
  return null;
}

/** True when the extraction's domain lands in the same family as the label. */
export function domainMatches(expected: string, observed: string): boolean {
  const want = domainFamily(expected);
  if (want === null) return false;
  return want === domainFamily(observed);
}

/** The synonym group a module name belongs to, as canonical keys. */
function synonymGroup(name: string): Set<string> {
  const key = canonicalModuleKey(name);
  const group = new Set<string>([key]);
  for (const [canonical, synonyms] of Object.entries(SCOPING.moduleSynonyms)) {
    const keys = [canonical, ...synonyms].map(canonicalModuleKey);
    if (keys.includes(key)) for (const k of keys) group.add(k);
  }
  return group;
}

/**
 * Two module names that mean the same thing. "Notifications" answers
 * "Notification", and the synonym table in lib/config/scoping.ts makes
 * "Bookings" answer "Appointments" — the label asks for the capability, not
 * for the word the model happened to choose.
 */
export function sameModule(a: string, b: string): boolean {
  if (canonicalModuleKey(a) === canonicalModuleKey(b)) return true;
  return synonymGroup(a).has(canonicalModuleKey(b));
}

/**
 * The share of `expected` modules present in `observed`. 1 when nothing is
 * expected — a case with no must-have modules cannot lose recall.
 */
export function moduleRecall(
  expected: readonly string[],
  observed: readonly string[],
): { recall: number; missing: string[] } {
  if (expected.length === 0) return { recall: 1, missing: [] };
  const missing = expected.filter(
    (name) => !observed.some((found) => sameModule(name, found)),
  );
  return { recall: (expected.length - missing.length) / expected.length, missing };
}

/** Forbidden strings (an injection payload) that reached the output. */
export function leakedStrings(forbidden: readonly string[], haystack: string): string[] {
  const text = haystack.toLowerCase();
  return forbidden.filter((needle) => text.includes(needle.toLowerCase()));
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Population standard deviation — the spread of these runs, not an estimate. */
export function stdev(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

/**
 * Nearest-rank percentile: p50 of 3 values is the 2nd, p95 of 20 is the 19th.
 * Small sample sizes make interpolation a false precision here.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

/** The share of `values` that are true, as a 0-1 rate (0 when empty). */
export function rate(values: readonly boolean[]): number {
  return values.length === 0 ? 0 : values.filter(Boolean).length / values.length;
}

/** Every run agreed with every other run. */
export function allAgree<T>(values: readonly T[]): boolean {
  return new Set(values).size <= 1;
}

export interface Prices {
  /** US dollars per million tokens. */
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** What the run cost at these prices, in US dollars. */
export function estimateCost(tokens: TokenTotals, prices: Prices): number {
  return (
    (tokens.input * prices.input +
      tokens.output * prices.output +
      tokens.cacheRead * prices.cacheRead +
      tokens.cacheWrite * prices.cacheWrite) /
    1_000_000
  );
}
