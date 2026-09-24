import type { ModuleSize } from "@/lib/schemas/extraction";
import { domainKey } from "@/lib/scoring/domain";
import { SCOPING } from "@/lib/config/scoping";

/**
 * Calibration: what this workspace's estimates were actually worth.
 *
 * A factor is a ratio — what it took, over what we said it would take.
 * Above 1 means the estimate was optimistic; below 1 means it was cautious.
 * Two kinds are computed:
 *
 *   by domain   sprints actually spent / sprints estimated, per domain
 *   by size     sprints a module of that estimated size actually took /
 *               sprints the estimate implied for it
 *
 * A factor is only offered once `MIN_PROJECTS` projects stand behind it.
 * Four projects can be four unusual ones, and an estimate that swings on
 * one bad quarter is worse than no adjustment at all.
 *
 * Everything here is arithmetic on numbers that were recorded by hand. No
 * model sees it, and nothing in this file reads a brief, a note or a name.
 */

/** Below this, a factor is computed and reported but never applied. */
export const MIN_PROJECTS = 5;

/** A sprint is two weeks, everywhere in the estimate engine. */
export const WEEKS_PER_SPRINT = 2;

/** Bounds on a factor: past these, the record is likelier wrong than the estimate. */
const MIN_RATIO = 0.25;
const MAX_RATIO = 4;

export type FactorConfidence = "none" | "low" | "medium" | "high";

export interface CalibrationFactor {
  /** actual / estimated. 1 means the estimate was right. */
  ratio: number;
  /** How many recorded projects stand behind it. */
  projects: number;
  confidence: FactorConfidence;
  /** False when `projects` is under MIN_PROJECTS: shown, never applied. */
  applicable: boolean;
}

export interface ActualModuleRecord {
  /** The size the scope gave it. */
  estimatedSize: ModuleSize;
  /** The size it turned out to be. Recorded for the report, not the maths. */
  actualSize: ModuleSize;
  /** Sprints it actually took. */
  actualSprints: number;
}

/** One recorded project, as the maths needs it. */
export interface ActualRecord {
  projectId: string;
  domain: string;
  actualWeeks: number;
  actualTeamSize: number;
  scopeAccuracy: number;
  modules: ActualModuleRecord[];
  estimatedSprints: number;
  estimatedPoints: number;
  estimatedTeamSize: number;
  estimatedVelocity: number;
  domainMultiplier: number;
  recordedAt: Date;
}

export interface CalibrationFactors {
  /** Keyed by the canonical domain key, not by the words in the brief. */
  byDomain: Record<string, CalibrationFactor>;
  bySize: Partial<Record<ModuleSize, CalibrationFactor>>;
  /** Every recorded project, regardless of domain. */
  overall: CalibrationFactor | null;
  projects: number;
}

/** Sprints a project actually took, from the weeks someone recorded. */
export function actualSprints(record: Pick<ActualRecord, "actualWeeks">): number {
  return record.actualWeeks / WEEKS_PER_SPRINT;
}

/**
 * The sprints the estimate implied for one module: its points (after the
 * domain multiplier) at the velocity the estimate assumed.
 */
export function estimatedModuleSprints(
  size: ModuleSize,
  record: Pick<ActualRecord, "domainMultiplier" | "estimatedVelocity">,
): number {
  const points = SCOPING.modulePoints[size] * (record.domainMultiplier || 1);
  const velocity = record.estimatedVelocity > 0 ? record.estimatedVelocity : 26;
  return points / velocity;
}

export function confidenceFor(projects: number): FactorConfidence {
  if (projects < MIN_PROJECTS) return "none";
  if (projects < 10) return "low";
  if (projects < 20) return "medium";
  return "high";
}

function factor(actual: number, estimated: number, projects: number): CalibrationFactor {
  const raw = estimated > 0 ? actual / estimated : 1;
  const ratio = round2(Math.min(MAX_RATIO, Math.max(MIN_RATIO, raw)));
  return {
    ratio,
    projects,
    confidence: confidenceFor(projects),
    applicable: projects >= MIN_PROJECTS,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The factors a set of recorded projects supports.
 *
 * Ratios are computed from summed totals rather than as a mean of per-project
 * ratios, so one tiny project cannot weigh as much as a six-month one.
 */
export function computeFactors(records: readonly ActualRecord[]): CalibrationFactors {
  const byDomain: Record<string, CalibrationFactor> = {};
  const domainTotals = new Map<
    string,
    { actual: number; estimated: number; projects: Set<string> }
  >();
  const sizeTotals = new Map<
    ModuleSize,
    { actual: number; estimated: number; projects: Set<string> }
  >();
  let overallActual = 0;
  let overallEstimated = 0;

  for (const record of records) {
    const actual = actualSprints(record);
    const estimated = record.estimatedSprints;
    if (!(estimated > 0) || !(actual > 0)) continue;

    overallActual += actual;
    overallEstimated += estimated;

    const key = domainKey(record.domain) ?? "other";
    const domainEntry = domainTotals.get(key) ?? {
      actual: 0,
      estimated: 0,
      projects: new Set<string>(),
    };
    domainEntry.actual += actual;
    domainEntry.estimated += estimated;
    domainEntry.projects.add(record.projectId);
    domainTotals.set(key, domainEntry);

    for (const row of record.modules) {
      const rowEstimated = estimatedModuleSprints(row.estimatedSize, record);
      if (!(rowEstimated > 0) || !(row.actualSprints > 0)) continue;
      const sizeEntry = sizeTotals.get(row.estimatedSize) ?? {
        actual: 0,
        estimated: 0,
        projects: new Set<string>(),
      };
      sizeEntry.actual += row.actualSprints;
      sizeEntry.estimated += rowEstimated;
      sizeEntry.projects.add(record.projectId);
      sizeTotals.set(row.estimatedSize, sizeEntry);
    }
  }

  for (const [key, totals] of domainTotals) {
    byDomain[key] = factor(totals.actual, totals.estimated, totals.projects.size);
  }

  const bySize: Partial<Record<ModuleSize, CalibrationFactor>> = {};
  for (const [size, totals] of sizeTotals) {
    bySize[size] = factor(totals.actual, totals.estimated, totals.projects.size);
  }

  const projects = new Set(records.map((r) => r.projectId)).size;
  return {
    byDomain,
    bySize,
    overall:
      overallEstimated > 0 ? factor(overallActual, overallEstimated, projects) : null,
    projects,
  };
}

/* ──────────────────────────────────────────────────────────────
 *  Applying them
 * ────────────────────────────────────────────────────────────── */

export type CalibrationSource = "workspace" | "shared";

/** What the estimate engine needs: the factors, and where they came from. */
export interface Calibration {
  bySize: Partial<Record<ModuleSize, CalibrationFactor>>;
  domain: CalibrationFactor | null;
  source: CalibrationSource;
}

/** What was applied, for "How we estimated this". */
export interface AppliedCalibration {
  /** Adjusted points / unadjusted points, e.g. 1.18. */
  multiplier: number;
  /** Projects behind the weakest factor used — the honest number to show. */
  projects: number;
  source: CalibrationSource;
  confidence: FactorConfidence;
}

/**
 * The factor for one module: its own size when that size has enough
 * history, otherwise the domain's, otherwise none. A factor that has not
 * reached MIN_PROJECTS is ignored here as well as in `computeFactors`,
 * because a caller can build a `Calibration` by hand.
 */
export function factorForSize(
  calibration: Calibration | null,
  size: ModuleSize,
): CalibrationFactor | null {
  if (!calibration) return null;
  const bySize = calibration.bySize[size];
  if (bySize?.applicable && bySize.projects >= MIN_PROJECTS) return bySize;
  const domain = calibration.domain;
  if (domain?.applicable && domain.projects >= MIN_PROJECTS) return domain;
  return null;
}

/**
 * The single multiplier a set of adjusted module points implies, and how
 * many projects stand behind it. Null when nothing was adjusted.
 */
export function summariseApplied(
  calibration: Calibration | null,
  basePoints: number,
  adjustedPoints: number,
  used: readonly CalibrationFactor[],
): AppliedCalibration | null {
  if (!calibration || used.length === 0 || basePoints <= 0) return null;
  const multiplier = round2(adjustedPoints / basePoints);
  if (multiplier === 1) return null;
  const projects = Math.min(...used.map((f) => f.projects));
  return {
    multiplier,
    projects,
    source: calibration.source,
    confidence: confidenceFor(projects),
  };
}

/** "Adjusted using 7 of your past projects: +18%". */
export function calibrationSentence(applied: AppliedCalibration): string {
  const percent = Math.round((applied.multiplier - 1) * 100);
  const direction = percent >= 0 ? `+${percent}%` : `${percent}%`;
  const whose =
    applied.source === "workspace"
      ? `${applied.projects} of your past projects`
      : `${applied.projects} shared projects`;
  return `Adjusted using ${whose}: ${direction}`;
}

/* ──────────────────────────────────────────────────────────────
 *  Estimate against actual, for /analytics
 * ────────────────────────────────────────────────────────────── */

export interface ProjectComparison {
  projectId: string;
  domain: string;
  estimatedSprints: number;
  actualSprints: number;
  /** actual / estimated. */
  ratio: number;
  /** |actual − estimated| / estimated, as a percentage. */
  errorPercent: number;
  scopeAccuracy: number;
  recordedAt: Date;
}

export function compareRecords(records: readonly ActualRecord[]): ProjectComparison[] {
  return records
    .filter((r) => r.estimatedSprints > 0)
    .map((record) => {
      const actual = actualSprints(record);
      const ratio = actual / record.estimatedSprints;
      return {
        projectId: record.projectId,
        domain: record.domain,
        estimatedSprints: record.estimatedSprints,
        actualSprints: round2(actual),
        ratio: round2(ratio),
        errorPercent: Math.round(Math.abs(ratio - 1) * 100),
        scopeAccuracy: record.scopeAccuracy,
        recordedAt: record.recordedAt,
      };
    })
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
}

/** The mean of |actual − estimated| / estimated, as a percentage. */
export function averageAbsoluteError(comparisons: readonly ProjectComparison[]): number {
  if (comparisons.length === 0) return 0;
  const total = comparisons.reduce((sum, c) => sum + c.errorPercent, 0);
  return Math.round(total / comparisons.length);
}

export interface ErrorTrendPoint {
  /** "2026-09". */
  month: string;
  projects: number;
  averageErrorPercent: number;
}

/** Average error by the month a project was recorded, oldest first. */
export function errorTrend(comparisons: readonly ProjectComparison[]): ErrorTrendPoint[] {
  const months = new Map<string, number[]>();
  for (const c of comparisons) {
    const month = `${c.recordedAt.getUTCFullYear()}-${String(c.recordedAt.getUTCMonth() + 1).padStart(2, "0")}`;
    months.set(month, [...(months.get(month) ?? []), c.errorPercent]);
  }
  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, errors]) => ({
      month,
      projects: errors.length,
      averageErrorPercent: Math.round(
        errors.reduce((sum, e) => sum + e, 0) / errors.length,
      ),
    }));
}
