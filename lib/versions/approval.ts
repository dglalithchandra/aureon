import "@/lib/server-only";
import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { approvals, auditLog, projects, users } from "@/lib/db/schema";
import { lockVersion, type VersionSummary } from "@/lib/versions/store";
import { sendChangesRequested } from "@/lib/auth/email";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Client approval (blueprint step 13).
 *
 * The client has no account — they arrive through an approval link — so the
 * identity kept is what they typed plus a SHA-256 of their IP. The address
 * itself is never stored: the hash is enough to tell two approvals apart and
 * to show the same person came back, and useless for anything else.
 *
 * Approving locks the version. Asking for changes leaves a note on the
 * project and tells the owner.
 */

export interface DecisionInput {
  projectId: string;
  versionId: string | null;
  versionNumber: number | null;
  shareToken: string;
  decision: "approved" | "changes_requested";
  name: string;
  email?: string | null;
  comment?: string | null;
  /** The raw address; only its hash is stored. */
  ip: string;
}

export interface DecisionResult {
  state: "approved" | "changes_requested";
  version: VersionSummary | null;
}

/** SHA-256, hex. Salted with the session secret so hashes are not portable. */
export function hashIp(ip: string): string {
  const salt = getServerEnv().SESSION_SECRET ?? "aureon";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

export async function recordDecision(input: DecisionInput): Promise<DecisionResult> {
  const db = getDatabase();
  const decidedAt = new Date();
  const name = input.name.trim().slice(0, 120);

  await db.insert(approvals).values({
    projectId: input.projectId,
    versionId: input.versionId,
    versionNumber: input.versionNumber,
    state: input.decision,
    comment: input.comment?.trim().slice(0, 2000) || null,
    approverName: name,
    approverEmail: input.email?.trim().slice(0, 200) || null,
    approverIpHash: hashIp(input.ip),
    shareToken: input.shareToken,
    decidedAt,
  });

  await db.insert(auditLog).values({
    action: `approval.${input.decision}`,
    subjectType: "project",
    subjectId: input.projectId,
    detail: {
      versionNumber: input.versionNumber,
      approver: name,
      ipHash: hashIp(input.ip),
      shareToken: input.shareToken.slice(0, 8),
    },
  });

  let version: VersionSummary | null = null;
  if (input.decision === "approved" && input.versionId) {
    version = await lockVersion(input.versionId, name, decidedAt);
  }
  if (input.decision === "changes_requested") {
    await notifyOwner(input);
  }

  logger.info("approval.recorded", {
    projectId: input.projectId,
    decision: input.decision,
    versionNumber: input.versionNumber,
  });
  return { state: input.decision, version };
}

/** Every decision on a project, newest first. */
export async function listApprovals(projectId: string) {
  return getDatabase()
    .select()
    .from(approvals)
    .where(eq(approvals.projectId, projectId))
    .orderBy(desc(approvals.createdAt));
}

/**
 * Tell the owner that changes were asked for. Email when the app has a
 * sender configured; the note itself is the approvals row, which the
 * project's own pages show either way.
 */
async function notifyOwner(input: DecisionInput): Promise<void> {
  const env = getServerEnv();
  if (!env.EMAIL_API_KEY || !env.EMAIL_FROM) {
    logger.info("approval.owner_not_emailed", { projectId: input.projectId });
    return;
  }

  const db = getDatabase();
  const [row] = await db
    .select({ email: users.email, title: projects.title })
    .from(projects)
    .leftJoin(users, eq(users.id, projects.userId))
    .where(eq(projects.id, input.projectId))
    .limit(1);
  if (!row?.email) {
    // An anonymous project has nobody to email; the note is still stored.
    logger.info("approval.owner_anonymous", { projectId: input.projectId });
    return;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  try {
    await sendChangesRequested({
      to: row.email,
      title: row.title,
      approver: input.name.trim().slice(0, 120),
      comment: input.comment?.trim().slice(0, 2000) ?? "",
      url: `${appUrl}/projects`,
    });
  } catch (err) {
    // The decision is recorded either way: a failed email must not lose it.
    logger.warn("approval.notify_failed", {
      message: err instanceof Error ? err.message : "unknown",
    });
  }
}
