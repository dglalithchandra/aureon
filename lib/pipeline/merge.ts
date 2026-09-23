import "@/lib/server-only";
import type {
  ExtractionResult,
  ModuleCandidate,
  ModuleSize,
} from "@/lib/schemas/extraction";
import { ReadmeModuleNameSchema, type GitHubEnrichment } from "@/lib/schemas/github";
import { canonicalModuleKey } from "@/lib/scoring/module-name";

/**
 * Merge GitHub enrichment signals into the extraction.
 *
 *   1. Existing modules get `github_validated = true` if a similarly named
 *      module appears in `module_frequency` (case-insensitive + plural fuzz).
 *
 *   2. Modules from `module_frequency` not already in the extraction are
 *      appended IF their similarity-weighted score crosses the threshold.
 *      Threshold scales with how many top matches we got — fewer matches →
 *      lower bar, since each one contributes more relative weight.
 *
 *   3. Module list capped at 40 (Zod ceiling).
 */
export function mergeGitHubSignals(
  extraction: ExtractionResult,
  enrichment: GitHubEnrichment,
): ExtractionResult {
  const freq = enrichment.module_frequency;
  if (Object.keys(freq).length === 0) return extraction;

  // Frequency is now similarity-weighted (a float). Pick the highest-weighted
  // canonical name per key, and keep how many repos vouched for it.
  const repos = enrichment.module_repos;
  const lowerFreq: Record<string, { name: string; weight: number; repos: number }> = {};
  for (const [name, weight] of Object.entries(freq)) {
    const k = canonicalModuleKey(name);
    const prev = lowerFreq[k];
    const entry = { name, weight, repos: repos[name] ?? 0 };
    if (!prev) lowerFreq[k] = entry;
    else if (weight > prev.weight)
      lowerFreq[k] = { ...entry, repos: prev.repos + entry.repos };
    else lowerFreq[k] = { ...prev, repos: prev.repos + entry.repos };
  }

  const matchedKeys = new Set<string>();
  const updatedModules: ModuleCandidate[] = extraction.modules.map((m) => {
    const k = canonicalModuleKey(m.name);
    const hit = lowerFreq[k];
    if (hit) {
      matchedKeys.add(k);
      return { ...m, github_validated: true };
    }
    return m;
  });

  // A module nobody asked for is only added when several repos agree on it:
  // weight 1.0 (no single repo can contribute more than 0.8) AND at least two
  // different repos. One repo — or one injected README — cannot invent a
  // module and have it shown as "GitHub-validated" (SEC-04).
  const NEW_MODULE_WEIGHT_THRESHOLD = 1.0;
  const NEW_MODULE_MIN_REPOS = 2;

  // Sort candidates by descending weight so we add the strongest first.
  const sortedNew = Object.entries(lowerFreq)
    .filter(([k]) => !matchedKeys.has(k))
    .filter(
      ([, info]) =>
        info.weight >= NEW_MODULE_WEIGHT_THRESHOLD &&
        info.repos >= NEW_MODULE_MIN_REPOS &&
        ReadmeModuleNameSchema.safeParse(info.name).success,
    )
    .sort((a, b) => b[1].weight - a[1].weight);

  for (const [, info] of sortedNew) {
    if (updatedModules.length >= 40) break;
    updatedModules.push({
      module_confidence: null,
      seen_in: [],
      name: info.name,
      description: `Common ${info.name} module observed in similar open-source projects.`,
      size: defaultSizeForName(info.name),
      source_signal: `GitHub-validated · weight ${info.weight.toFixed(2)} across ${info.repos} matches`,
      github_validated: true,
    });
  }

  return { ...extraction, modules: updatedModules };
}

const SIZE_HINTS: Array<{ pattern: RegExp; size: ModuleSize }> = [
  { pattern: /\b(payment|billing|subscription|checkout|invoice)\b/i, size: "LARGE" },
  { pattern: /\b(auth|sso|rbac|permissions)\b/i, size: "MEDIUM" },
  { pattern: /\b(realtime|websocket|chat|stream)\b/i, size: "LARGE" },
  { pattern: /\b(dashboard|analytics|reports)\b/i, size: "MEDIUM" },
  { pattern: /\b(notifications|email|sms)\b/i, size: "MEDIUM" },
  { pattern: /\b(admin|settings|profile)\b/i, size: "SMALL" },
];

function defaultSizeForName(name: string): ModuleSize {
  for (const h of SIZE_HINTS) if (h.pattern.test(name)) return h.size;
  return "SMALL";
}
