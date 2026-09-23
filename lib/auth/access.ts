import "@/lib/server-only";
import { and, count, eq, isNull } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { projects, workspaceMembers, type WorkspaceRole } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/viewer";

/**
 * Who may do what to a project.
 *
 *   owner   everything, including delete and share
 *   editor  run rounds, answer, finalize, share — not delete
 *   viewer  read only
 *
 * A project has an owner in one of two ways: a signed-in user owns it
 * (`user_id`), or an anonymous browser does (`anon_owner_id`, BUG-03). A
 * project that belongs to a workspace is also reachable by that workspace's
 * members, at their role.
 *
 * Anonymous access survives sign-up on purpose: a browser that never signs
 * in keeps its own scope.
 */

export type Capability = "read" | "write" | "delete";

const ALLOWED: Record<WorkspaceRole, readonly Capability[]> = {
  owner: ["read", "write", "delete"],
  editor: ["read", "write"],
  viewer: ["read"],
};

export function can(role: WorkspaceRole | null, capability: Capability): boolean {
  return role !== null && ALLOWED[role].includes(capability);
}

/** Just enough of a project row to decide access. */
export interface AccessSubject {
  id: string;
  userId: string | null;
  workspaceId: string | null;
  anonOwnerId: string | null;
}

/**
 * The viewer's role on a project, or null when they have none. Ownership is
 * checked first and needs no query; workspace membership costs one.
 */
export async function roleFor(
  viewer: Viewer,
  subject: AccessSubject,
): Promise<WorkspaceRole | null> {
  if (viewer.userId && subject.userId === viewer.userId) return "owner";
  // An anonymous project answers to the browser that made it, until an
  // account claims it.
  if (subject.userId === null && viewer.anonId && subject.anonOwnerId === viewer.anonId) {
    return "owner";
  }
  if (!viewer.userId || !subject.workspaceId) return null;

  const [membership] = await getDatabase()
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, subject.workspaceId),
        eq(workspaceMembers.userId, viewer.userId),
      ),
    )
    .limit(1);
  if (!membership) return null;
  return isRole(membership.role) ? membership.role : null;
}

function isRole(value: string): value is WorkspaceRole {
  return value === "owner" || value === "editor" || value === "viewer";
}

/** The access subject for a project id, or null when there is no such row. */
export async function loadAccessSubject(id: string): Promise<AccessSubject | null> {
  const [row] = await getDatabase()
    .select({
      id: projects.id,
      userId: projects.userId,
      workspaceId: projects.workspaceId,
      anonOwnerId: projects.anonOwnerId,
    })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  return row ?? null;
}

/** A user's role in a workspace, or null when they are not a member. */
export async function workspaceRoleFor(
  viewer: Viewer,
  workspaceId: string,
): Promise<WorkspaceRole | null> {
  if (!viewer.userId) return null;
  const [membership] = await getDatabase()
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, viewer.userId),
      ),
    )
    .limit(1);
  if (!membership) return null;
  return isRole(membership.role) ? membership.role : null;
}

/** How many projects this browser has made while signed out (step 1's limit). */
export async function anonymousProjectCount(anonId: string): Promise<number> {
  const [row] = await getDatabase()
    .select({ total: count() })
    .from(projects)
    .where(and(eq(projects.anonOwnerId, anonId), isNull(projects.userId)));
  return row?.total ?? 0;
}
