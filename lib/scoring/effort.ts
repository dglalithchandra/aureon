import { SCOPING } from "@/lib/config/scoping";
import { domainKey } from "@/lib/scoring/domain";
import type { ModuleCandidate, ModuleSize } from "@/lib/schemas/extraction";

/**
 * Effort estimation (blueprint step 10) — computed, never asked of the model.
 *
 *   points per module  SMALL 8, MEDIUM 21, LARGE 40
 *   × domain complexity   FinTech 1.4, Healthcare 1.35, Marketplace 1.25,
 *                         SaaS 1.1, Internal Tool 0.85, everything else 1.0
 *   sprints = ceil(total points / velocity)
 *   velocity by team size 1 → 13, 2-3 → 26, 4-6 → 45, 7-10 → 60 per 2 weeks
 *   band from the session score  ≥ 80 → ±20%, 60-79 → ±35%, below → unreliable
 *
 * Every number in the engineer document comes from here; the model only
 * writes the sprint focus text (see lib/pipeline/finalize.ts). Client-safe,
 * because the engineer view recalculates live when the team size is edited.
 */

export interface EffortModule {
  name: string;
  size: ModuleSize;
  /** Before the domain multiplier. */
  basePoints: number;
  /** basePoints × multiplier, rounded, so the listed points add up to the total. */
  points: number;
}

export interface SprintPlanRow {
  sprint: string;
  modules: string[];
  storyPoints: number;
}

export interface EstimateBand {
  /** "±20%", "±35%", or "unreliable — clarify first". */
  label: string;
  /** null when the estimate should not be relied on. */
  percent: number | null;
  /** The sprint range the band implies; both equal `sprints` when unreliable. */
  lowSprints: number;
  highSprints: number;
  reliable: boolean;
}

export interface EffortEstimate {
  domain: string;
  domainKey: string | null;
  multiplier: number;
  teamSize: number;
  /** True when a human said the team size; false when it is the default. */
  teamSizeStated: boolean;
  velocity: number;
  modules: EffortModule[];
  totalPoints: number;
  sprints: number;
  band: EstimateBand;
  plan: SprintPlanRow[];
}

/** Story points for a module size, before the domain multiplier. */
export function pointsFor(size: ModuleSize): number {
  return SCOPING.modulePoints[size];
}

/** The domain complexity multiplier, 1.0 for a domain we have no table for. */
export function complexityFor(domain: string): number {
  const key = domainKey(domain);
  if (key === null) return SCOPING.defaultComplexity;
  return SCOPING.domainComplexity[key] ?? SCOPING.defaultComplexity;
}

/** Story points per two-week sprint for a team of this size. */
export function velocityFor(teamSize: number): number {
  const size = clampTeam(teamSize);
  const band =
    SCOPING.velocityBands.find((b) => size <= b.maxTeam) ??
    SCOPING.velocityBands[SCOPING.velocityBands.length - 1]!;
  return band.velocity;
}

/** Team sizes outside the bands are clamped, never rejected. */
export function clampTeam(teamSize: number): number {
  if (!Number.isFinite(teamSize)) return SCOPING.defaultTeamSize;
  return Math.min(SCOPING.maxTeamSize, Math.max(1, Math.round(teamSize)));
}

/** How wide the estimate is, given the session's confidence score. */
export function bandFor(confidence: number, sprints: number): EstimateBand {
  const band =
    SCOPING.estimateBands.find((b) => confidence >= b.minScore) ??
    SCOPING.estimateBands[SCOPING.estimateBands.length - 1]!;
  if (band.percent === null) {
    return {
      label: band.label,
      percent: null,
      lowSprints: sprints,
      highSprints: sprints,
      reliable: false,
    };
  }
  const delta = band.percent / 100;
  return {
    label: band.label,
    percent: band.percent,
    lowSprints: Math.max(1, Math.floor(sprints * (1 - delta))),
    highSprints: Math.ceil(sprints * (1 + delta)),
    reliable: true,
  };
}

/**
 * The band a stored label came from, re-attached to a new sprint count. The
 * engineer view uses it to move the range when the team size is edited; an
 * unrecognised label (a document from before the engine) is treated as one
 * that cannot be relied on.
 */
export function bandWithLabel(label: string, sprints: number): EstimateBand {
  const band = SCOPING.estimateBands.find((b) => b.label === label);
  if (!band) {
    return {
      label,
      percent: null,
      lowSprints: sprints,
      highSprints: sprints,
      reliable: false,
    };
  }
  return bandFor(band.minScore, sprints);
}

/**
 * Fill sprints to the team's velocity, in build order, splitting a module
 * across sprints when it does not fit — a 40-point module genuinely spans
 * sprints for a solo developer. The result therefore always holds exactly
 * `sprints` rows, which is what ceil(points / velocity) means.
 *
 * Past SCOPING.maxSprintRows rows (the schema's limit) the remainder is
 * folded into one final row covering the rest.
 */
export function planSprints(
  modules: EffortModule[],
  velocity: number,
  sprints: number,
): SprintPlanRow[] {
  const rows: SprintPlanRow[] = [];
  const queue = modules.filter((m) => m.points > 0).map((m) => ({ ...m }));
  let index = 0;

  for (let sprint = 1; sprint <= sprints; sprint++) {
    const row: SprintPlanRow = {
      sprint: `Sprint ${sprint}`,
      modules: [],
      storyPoints: 0,
    };
    while (row.storyPoints < velocity && index < queue.length) {
      const next = queue[index]!;
      const take = Math.min(next.points, velocity - row.storyPoints);
      row.storyPoints += take;
      next.points -= take;
      if (!row.modules.includes(next.name)) row.modules.push(next.name);
      if (next.points === 0) index++;
    }
    rows.push(row);
  }

  if (rows.length > SCOPING.maxSprintRows) {
    const kept = rows.slice(0, SCOPING.maxSprintRows - 1);
    const rest = rows.slice(SCOPING.maxSprintRows - 1);
    kept.push({
      sprint: `Sprints ${SCOPING.maxSprintRows}-${sprints}`,
      modules: [...new Set(rest.flatMap((r) => r.modules))].slice(0, 20),
      storyPoints: rest.reduce((sum, r) => sum + r.storyPoints, 0),
    });
    return kept;
  }
  return rows;
}

export interface EffortInput {
  modules: ReadonlyArray<Pick<ModuleCandidate, "name" | "size">>;
  domain: string;
  /** The session's computed confidence score (ARCH-01), 0-100. */
  confidence: number;
  /** Stated team size; the default is used when this is null or undefined. */
  teamSize?: number | null;
  /** Whether `teamSize` came from a human rather than from the default. */
  teamSizeStated?: boolean;
}

/** The whole estimate, from the module list to the sprint plan. */
export function estimateEffort(input: EffortInput): EffortEstimate {
  const multiplier = complexityFor(input.domain);
  const modules: EffortModule[] = input.modules.map((m) => {
    const basePoints = pointsFor(m.size);
    return {
      name: m.name,
      size: m.size,
      basePoints,
      points: Math.round(basePoints * multiplier),
    };
  });

  const totalPoints = modules.reduce((sum, m) => sum + m.points, 0);
  const teamSize = clampTeam(input.teamSize ?? SCOPING.defaultTeamSize);
  const velocity = velocityFor(teamSize);
  // At least one sprint: a scope with no sized modules is still a project,
  // and EffortSummarySchema stores a minimum of 1.
  const sprints = Math.max(1, Math.ceil(totalPoints / velocity));

  return {
    domain: input.domain,
    domainKey: domainKey(input.domain),
    multiplier,
    teamSize,
    teamSizeStated: input.teamSizeStated === true && input.teamSize != null,
    velocity,
    modules,
    totalPoints,
    sprints,
    band: bandFor(input.confidence, sprints),
    plan: planSprints(modules, velocity, sprints),
  };
}

/* ──────────────────────────────────────────────────────────────
 *  Team size, read from what the user actually wrote
 * ────────────────────────────────────────────────────────────── */

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const COUNT = `(\\d{1,3}|${Object.keys(NUMBER_WORDS).join("|")})`;
const DEVELOPER = "(?:person|people|developer|developers|dev|devs|engineer|engineers)";

/**
 * Phrases that state the size of the team building this, as opposed to the
 * number of users, drivers or students — those are everywhere in a brief and
 * must never be read as a team size.
 */
const TEAM_PATTERNS: RegExp[] = [
  new RegExp(`\\bteam of ${COUNT}\\b`, "i"),
  new RegExp(`\\b${COUNT}[- ]${DEVELOPER}[- ](?:team|squad)\\b`, "i"),
  new RegExp(`\\b${COUNT} (?:developers|devs|engineers)\\b`, "i"),
  new RegExp(
    `\\b${COUNT} (?:people|person)[^.!?]{0,24}\\b(?:our side|in-house|internally)\\b`,
    "i",
  ),
  new RegExp(`\\bwe are ${COUNT}\\b`, "i"),
];

const SOLO = /\b(?:solo|just me|on my own|one[- ]person|single developer)\b/i;

/**
 * The team size stated in a piece of text, or null. The last statement in
 * the text wins, because a later answer corrects an earlier brief.
 */
export function teamSizeIn(text: string): number | null {
  let found: number | null = null;
  for (const sentence of text.split(/[.!?\n]/)) {
    for (const pattern of TEAM_PATTERNS) {
      const match = pattern.exec(sentence);
      if (!match?.[1]) continue;
      const raw = match[1].toLowerCase();
      const value = NUMBER_WORDS[raw] ?? Number(raw);
      if (Number.isFinite(value) && value >= 1) found = clampTeam(value);
    }
    if (SOLO.test(sentence)) found = 1;
  }
  return found;
}

/**
 * The team size to estimate with: what the user said, anywhere in the brief
 * or the answers, otherwise the configured default. `texts` is passed
 * oldest-first so the newest statement wins.
 */
export function teamSizeFrom(texts: readonly string[]): {
  size: number;
  stated: boolean;
} {
  for (let i = texts.length - 1; i >= 0; i--) {
    const found = teamSizeIn(texts[i] ?? "");
    if (found !== null) return { size: found, stated: true };
  }
  return { size: SCOPING.defaultTeamSize, stated: false };
}
