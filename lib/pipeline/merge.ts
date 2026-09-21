import "@/lib/server-only";
import type {
  ExtractionResult,
  ModuleCandidate,
  ModuleSize,
} from "@/lib/schemas/extraction";
import type { GitHubEnrichment } from "@/lib/schemas/github";

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
  // canonical name per key.
  const lowerFreq: Record<string, { name: string; weight: number }> = {};
  for (const [name, weight] of Object.entries(freq)) {
    const k = canonicalModuleKey(name);
    const prev = lowerFreq[k];
    if (!prev || weight > prev.weight) lowerFreq[k] = { name, weight };
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

  // Threshold: roughly "at least one strong match contributed it OR two
  // marginal matches did". With weights mostly between 0.3 and 0.95, 1.0
  // requires either 1.5x average match strength or 2 mediocre ones.
  const NEW_MODULE_WEIGHT_THRESHOLD = 1.0;

  // Sort candidates by descending weight so we add the strongest first.
  const sortedNew = Object.entries(lowerFreq)
    .filter(([k]) => !matchedKeys.has(k))
    .filter(([, info]) => info.weight >= NEW_MODULE_WEIGHT_THRESHOLD)
    .sort((a, b) => b[1].weight - a[1].weight);

  for (const [, info] of sortedNew) {
    if (updatedModules.length >= 40) break;
    updatedModules.push({
      name: info.name,
      description: `Common ${info.name} module observed in similar open-source projects.`,
      size: defaultSizeForName(info.name),
      source_signal: `GitHub-validated · weight ${info.weight.toFixed(2)} across top matches`,
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

/**
 * Canonical key for module-name comparison. Lowercase, strip non-alphanum,
 * strip common plural "s" suffix so "Notification" and "Notifications" merge.
 */
function canonicalModuleKey(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return base.endsWith("s") && base.length > 3 ? base.slice(0, -1) : base;
}
