import "@/lib/server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { projectActuals, projects, workspaces } from "@/lib/db/schema";
import { domainKey } from "@/lib/scoring/domain";
import { logger } from "@/lib/logger";
import {
  computeFactors,
  MIN_PROJECTS,
  type ActualRecord,
  type Calibration,
  type CalibrationFactors,
} from "@/lib/calibration/factors";
import { ActualsModulesSchema } from "@/lib/schemas/actuals";

/**
 * Reading the recorded actuals, and turning them into the factors the
 * estimate engine uses.
 *
 * Two pools, and the boundary between them is the whole point:
 *
 *   the workspace's own   always available to that workspace
 *   the shared pool       only workspaces that opted in contribute to it,
 *                         and only they may read it
 *
 * The shared pool is computed by a query that selects numbers and the fixed
 * domain label, and nothing else — no note, no module name, no project id,
 * no workspace id. A workspace that has not opted in is excluded on both
 * sides of that query, so opting out is not a filter applied later but the
 * absence of a row in the first place.
 */

type ActualsRow = typeof projectActuals.$inferSelect;

function toRecord(row: ActualsRow): ActualRecord | null {
  const modules = ActualsModulesSchema.safeParse(row.modules);
  if (!modules.success) {
    logger.warn("calibration.modules_unreadable", { projectId: row.projectId });
    return null;
  }
  return {
    projectId: row.projectId,
    domain: row.domain,
    actualWeeks: row.actualWeeks,
    actualTeamSize: row.actualTeamSize,
    scopeAccuracy: row.scopeAccuracy,
    modules: modules.data,
    estimatedSprints: row.estimatedSprints,
    estimatedPoints: row.estimatedPoints,
    estimatedTeamSize: row.estimatedTeamSize,
    estimatedVelocity: row.estimatedVelocity,
    domainMultiplier: row.domainMultiplier,
    recordedAt: row.updatedAt,
  };
}

/** Every recorded project in one workspace. */
export async function workspaceRecords(workspaceId: string): Promise<ActualRecord[]> {
  const rows = await getDatabase()
    .select()
    .from(projectActuals)
    .where(eq(projectActuals.workspaceId, workspaceId));
  return rows.map(toRecord).filter((r): r is ActualRecord => r !== null);
}

/** The recorded actuals for one project, or null. */
export async function projectRecord(projectId: string): Promise<ActualRecord | null> {
  const [row] = await getDatabase()
    .select()
    .from(projectActuals)
    .where(eq(projectActuals.projectId, projectId))
    .limit(1);
  return row ? toRecord(row) : null;
}

export async function workspaceFactors(workspaceId: string): Promise<CalibrationFactors> {
  return computeFactors(await workspaceRecords(workspaceId));
}

/**
 * What crosses a workspace boundary: one aggregate row per (domain, size),
 * counting projects and summing sprints. Numbers, and a domain label from
 * the fixed list — never a note, a module name, a title or an id.
 */
export interface SharedAggregate {
  domain: string;
  projects: number;
  actualSprints: number;
  estimatedSprints: number;
}

/**
 * The shared pool, as seen by one workspace: every other workspace that has
 * opted in. A workspace that has not opted in gets nothing, because the
 * pool is something you join, not something you read.
 */
export async function sharedPool(viewingWorkspaceId: string): Promise<ActualRecord[]> {
  const db = getDatabase();
  const [viewer] = await db
    .select({ shareCalibration: workspaces.shareCalibration })
    .from(workspaces)
    .where(eq(workspaces.id, viewingWorkspaceId))
    .limit(1);
  if (!viewer?.shareCalibration) return [];

  // Only the columns the maths needs. `note` and the module names are not
  // in this select, so there is nothing to strip afterwards.
  const rows = await db
    .select({
      projectId: projectActuals.projectId,
      domain: projectActuals.domain,
      actualWeeks: projectActuals.actualWeeks,
      actualTeamSize: projectActuals.actualTeamSize,
      scopeAccuracy: projectActuals.scopeAccuracy,
      estimatedSprints: projectActuals.estimatedSprints,
      estimatedPoints: projectActuals.estimatedPoints,
      estimatedTeamSize: projectActuals.estimatedTeamSize,
      estimatedVelocity: projectActuals.estimatedVelocity,
      domainMultiplier: projectActuals.domainMultiplier,
      updatedAt: projectActuals.updatedAt,
      sizes: sql<unknown>`jsonb_path_query_array(${projectActuals.modules}, '$[*].estimatedSize')`,
      sprints: sql<unknown>`jsonb_path_query_array(${projectActuals.modules}, '$[*].actualSprints')`,
    })
    .from(projectActuals)
    .innerJoin(workspaces, eq(workspaces.id, projectActuals.workspaceId))
    .where(
      and(
        eq(workspaces.shareCalibration, true),
        ne(projectActuals.workspaceId, viewingWorkspaceId),
      ),
    );

  return rows.map((row) => ({
    // An id is needed to count projects; it never leaves this process, and
    // the anonymous pool is only ever reported as counts and ratios.
    projectId: row.projectId,
    domain: row.domain,
    actualWeeks: row.actualWeeks,
    actualTeamSize: row.actualTeamSize,
    scopeAccuracy: row.scopeAccuracy,
    modules: zipModules(row.sizes, row.sprints),
    estimatedSprints: row.estimatedSprints,
    estimatedPoints: row.estimatedPoints,
    estimatedTeamSize: row.estimatedTeamSize,
    estimatedVelocity: row.estimatedVelocity,
    domainMultiplier: row.domainMultiplier,
    recordedAt: row.updatedAt,
  }));
}

/** Sizes and sprints, without the module names that sat beside them. */
function zipModules(sizes: unknown, sprints: unknown): ActualRecord["modules"] {
  const sizeList = Array.isArray(sizes) ? sizes : [];
  const sprintList = Array.isArray(sprints) ? sprints : [];
  const out: ActualRecord["modules"] = [];
  for (let i = 0; i < sizeList.length; i += 1) {
    const size = sizeList[i];
    const actual = sprintList[i];
    if (size !== "SMALL" && size !== "MEDIUM" && size !== "LARGE") continue;
    if (typeof actual !== "number") continue;
    out.push({ estimatedSize: size, actualSize: size, actualSprints: actual });
  }
  return out;
}

/**
 * The calibration to estimate one project with: this workspace's own
 * factors when it has MIN_PROJECTS behind them, otherwise the shared pool
 * if the workspace opted in, otherwise nothing.
 */
export async function calibrationFor(
  workspaceId: string | null,
  domain: string,
): Promise<Calibration | null> {
  if (!workspaceId) return null;
  try {
    const own = await workspaceFactors(workspaceId);
    const key = domainKey(domain) ?? "other";
    const mine = calibrationFrom(own, key, "workspace");
    if (mine) return mine;

    const shared = computeFactors(await sharedPool(workspaceId));
    return calibrationFrom(shared, key, "shared");
  } catch (err) {
    // A calibration that cannot be read is not a reason to fail a finalize.
    logger.warn("calibration.unavailable", {
      workspaceId,
      message: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }
}

function calibrationFrom(
  factors: CalibrationFactors,
  key: string,
  source: Calibration["source"],
): Calibration | null {
  const domain = factors.byDomain[key] ?? null;
  const bySize = Object.fromEntries(
    Object.entries(factors.bySize).filter(([, f]) => f.projects >= MIN_PROJECTS),
  ) as Calibration["bySize"];
  const hasDomain = domain !== null && domain.projects >= MIN_PROJECTS;
  if (!hasDomain && Object.keys(bySize).length === 0) return null;
  return { bySize, domain: hasDomain ? domain : null, source };
}

/** The workspace a project belongs to, for the estimate path. */
export async function calibrationForProject(
  projectId: string,
  domain: string,
): Promise<Calibration | null> {
  try {
    const [row] = await getDatabase()
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return calibrationFor(row?.workspaceId ?? null, domain);
  } catch (err) {
    logger.warn("calibration.project_lookup_failed", {
      projectId,
      message: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }
}
