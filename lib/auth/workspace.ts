import "@/lib/server-only";
import { and, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import {
  projects,
  users,
  workspaceMembers,
  workspaces,
  type WorkspaceRole,
} from "@/lib/db/schema";
import { logger } from "@/lib/logger";

/**
 * Everyone gets a workspace.
 *
 * A single user working alone should not have to think about workspaces at
 * all, so their first sign-in quietly creates one with them as its owner.
 * Inviting someone later is then a row in workspace_members rather than a
 * migration of everything they own.
 */

/** The user's own workspace, created on first use. */
export async function ensurePersonalWorkspace(userId: string): Promise<string> {
  const db = getDatabase();

  const [existing] = await db
    .select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.role, "owner")))
    .limit(1);
  if (existing) return existing.id;

  const [user] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const label = user?.name ?? user?.email?.split("@")[0] ?? "My";

  const workspaceId = await db.transaction(async (tx) => {
    const [workspace] = await tx
      .insert(workspaces)
      .values({ name: `${label}'s workspace` })
      .returning({ id: workspaces.id });
    await tx.insert(workspaceMembers).values({
      workspaceId: workspace!.id,
      userId,
      role: "owner",
    });
    return workspace!.id;
  });

  logger.info("workspace.created", { userId, workspaceId });
  return workspaceId;
}

/** Put a project under an account and its workspace. */
export async function assignProject(
  projectId: string,
  userId: string,
  workspaceId: string | null,
): Promise<void> {
  await getDatabase()
    .update(projects)
    .set({ userId, workspaceId })
    .where(eq(projects.id, projectId));
}

/** Add (or move) a member of a workspace. */
export async function setMember(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<void> {
  await getDatabase()
    .insert(workspaceMembers)
    .values({ workspaceId, userId, role })
    .onConflictDoUpdate({
      target: [workspaceMembers.workspaceId, workspaceMembers.userId],
      set: { role },
    });
}
