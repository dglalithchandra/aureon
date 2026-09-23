import { SCOPING, stateMultiplier } from "@/lib/config/scoping";
import { domainKey } from "@/lib/scoring/domain";
import { canonicalModuleKey } from "@/lib/scoring/module-name";
import type { ExtractionResult, ModuleCandidate } from "@/lib/schemas/extraction";
import type { GitHubEnrichment, RepoLink } from "@/lib/schemas/github";

/**
 * Per-module confidence (blueprint step 07).
 *
 *   moduleConfidence = 0.45 paramSignal + 0.35 githubFreq + 0.20 templateMatch
 *
 *   paramSignal   the best state multiplier among the parameters whose
 *                 evidence mentions the module (P-03, Core Features, when no
 *                 parameter names it)
 *   githubFreq    the share of matched repos that named the module, weighted
 *                 by how similar those repos are to this project
 *   templateMatch 1 when the module is standard for the domain, 0.5 for a
 *                 close synonym, 0 otherwise
 *
 * Like the session score (ARCH-01) this is computed here, never asked of the
 * model: it decides what the client sees as confirmed and what is offered as
 * a candidate to confirm.
 */

export type ModuleConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export interface ModuleScore {
  confidence: number;
  paramSignal: number;
  githubFreq: number;
  templateMatch: number;
  /** The matched repos that named this module. */
  seenIn: RepoLink[];
}

/** HIGH above 0.80, MEDIUM from 0.55 to 0.80, LOW below 0.55. */
export function moduleLevel(confidence: number | null): ModuleConfidenceLevel {
  if (confidence === null) return "MEDIUM";
  if (confidence > SCOPING.moduleHigh) return "HIGH";
  return confidence < SCOPING.moduleLow ? "LOW" : "MEDIUM";
}

/** Words of a name, lowercased: "API Keys" → ["api", "keys"]. */
function words(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** True when `text` names the module (all of its words appear in it). */
function mentions(text: string, moduleName: string): boolean {
  const haystack = ` ${words(text).join(" ")} `;
  const needles = words(moduleName);
  if (needles.length === 0) return false;
  return needles.every((w) => haystack.includes(` ${w} `) || haystack.includes(`${w}s `));
}

/**
 * The strongest parameter state among the parameters whose evidence names
 * this module. Falls back to P-03 (Core Features), which is where module
 * evidence lives when nothing names it directly.
 */
export function paramSignalFor(extraction: ExtractionResult, moduleName: string): number {
  let best: number | null = null;
  for (const p of extraction.parameters) {
    if (!p.evidence || !mentions(p.evidence, moduleName)) continue;
    const signal = stateMultiplier(p.state);
    if (best === null || signal > best) best = signal;
  }
  if (best !== null) return best;
  const features = extraction.parameters.find((p) => p.id === "P-03");
  return features ? stateMultiplier(features.state) : 0;
}

/**
 * How many matched repos named this module, as a share of the matches,
 * weighted by the average similarity of the repos that did.
 */
export function githubFreqFor(
  enrichment: GitHubEnrichment | null,
  moduleName: string,
): { freq: number; seenIn: RepoLink[] } {
  const matches = enrichment?.matches ?? [];
  if (matches.length === 0) return { freq: 0, seenIn: [] };

  const key = canonicalModuleKey(moduleName);
  const hits = matches.filter((m) =>
    [...m.modules_found, ...m.folders_found].some(
      (found) => canonicalModuleKey(found) === key,
    ),
  );
  if (hits.length === 0) return { freq: 0, seenIn: [] };

  const share = hits.length / matches.length;
  const avgSimilarity = hits.reduce((sum, m) => sum + m.similarity, 0) / hits.length;
  return {
    freq: share * avgSimilarity,
    seenIn: hits.slice(0, 8).map((m) => ({ repo: m.repo, url: m.url })),
  };
}

/** Standard modules for a domain label, or [] when the domain is unknown. */
function standardModulesFor(domain: string): readonly string[] {
  const key = domainKey(domain);
  return key === null ? [] : (SCOPING.domainModules[key] ?? []);
}

/** 1 for a standard module of this domain, 0.5 for a close synonym, else 0. */
export function templateMatchFor(domain: string, moduleName: string): number {
  const standard = standardModulesFor(domain);
  if (standard.length === 0) return 0;
  const key = canonicalModuleKey(moduleName);

  if (standard.some((name) => canonicalModuleKey(name) === key)) return 1;

  for (const [canonical, synonyms] of Object.entries(SCOPING.moduleSynonyms)) {
    const group = [canonical, ...synonyms].map(canonicalModuleKey);
    if (!group.includes(key)) continue;
    if (standard.some((name) => group.includes(canonicalModuleKey(name)))) return 0.5;
  }
  return 0;
}

/** The confidence of one module, and the repos behind it. */
export function scoreModule(
  extraction: ExtractionResult,
  enrichment: GitHubEnrichment | null,
  module: ModuleCandidate,
): ModuleScore {
  const w = SCOPING.moduleWeights;
  const paramSignal = paramSignalFor(extraction, module.name);
  const { freq, seenIn } = githubFreqFor(enrichment, module.name);
  const templateMatch = templateMatchFor(extraction.domain, module.name);
  const confidence =
    w.paramSignal * paramSignal + w.githubFreq * freq + w.templateMatch * templateMatch;

  return {
    confidence: Math.min(1, Math.max(0, Number(confidence.toFixed(4)))),
    paramSignal,
    githubFreq: freq,
    templateMatch,
    seenIn,
  };
}

/** The extraction with every module scored. Deterministic. */
export function scoreModules(
  extraction: ExtractionResult,
  enrichment: GitHubEnrichment | null,
): ExtractionResult {
  return {
    ...extraction,
    modules: extraction.modules.map((module) => {
      const scored = scoreModule(extraction, enrichment, module);
      return {
        ...module,
        module_confidence: scored.confidence,
        seen_in: scored.seenIn,
      };
    }),
  };
}
