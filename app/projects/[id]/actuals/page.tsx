import Link from "next/link";
import { notFound } from "next/navigation";
import { can, loadAccessSubject, roleFor } from "@/lib/auth/access";
import { getViewerFromCookies } from "@/lib/auth/viewer";
import { getSession } from "@/lib/storage/session";
import { projectTitle } from "@/lib/projects/list";
import { latestVersion } from "@/lib/versions/store";
import { projectRecord } from "@/lib/calibration/store";
import { ActualsForm } from "@/components/projects/ActualsForm";
import type { StoredActuals } from "@/lib/schemas/actuals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Record actuals — Aureon",
  robots: { index: false },
};

/**
 * What the project actually cost, against what was estimated for it — the
 * input side of the calibration loop.
 *
 * Only for an approved project: comparing against a scope nobody agreed to
 * measures the wrong thing.
 */
export default async function ActualsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const subject = await loadAccessSubject(id);
  if (!subject) notFound();

  const viewer = await getViewerFromCookies();
  const role = await roleFor(viewer, subject);
  if (!can(role, "read")) notFound();

  const [session, title, version, existing] = await Promise.all([
    getSession(id),
    projectTitle(id),
    latestVersion(id),
    projectRecord(id),
  ]);

  const output = session?.final_output;
  const approved = Boolean(version?.lockedAt);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12 sm:py-16">
      <header className="flex flex-col gap-2">
        <Link
          href={`/output/${id}`}
          className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase hover:text-[var(--color-blueprint-accent)]"
        >
          ← {title ?? "Back to the scope"}
        </Link>
        <h1 className="text-blueprint-text font-display text-3xl font-bold sm:text-4xl">
          Record actuals
        </h1>
        <p className="text-blueprint-muted text-sm leading-relaxed">
          What it really took. Five recorded projects is enough for Aureon to start
          adjusting new estimates by what your work actually costs, instead of by the same
          arithmetic for everyone.
        </p>
      </header>

      {!output || !approved ? (
        <p className="border-blueprint-line/20 text-blueprint-muted rounded-2xl border bg-white/[0.02] p-6 text-sm leading-relaxed">
          {!output
            ? "This project has no generated scope yet."
            : "Record actuals once a client has approved a version. Until then there is no agreed estimate to compare against — send it for approval from the scope page."}
        </p>
      ) : !can(role, "write") ? (
        <p className="border-blueprint-line/20 text-blueprint-muted rounded-2xl border bg-white/[0.02] p-6 text-sm">
          You can read this project but not record against it.
        </p>
      ) : (
        <ActualsForm
          projectId={id}
          projectTitle={title ?? "This project"}
          estimate={{
            sprints: output.engineer.effort_summary.total_sprints,
            teamSize: output.engineer.effort_summary.team_size,
            points: output.engineer.effort_summary.total_points,
          }}
          modules={output.engineer.module_table.map((m) => ({
            name: m.name,
            estimatedSize: m.size,
          }))}
          existing={toStored(existing, id)}
        />
      )}
    </main>
  );
}

function toStored(
  record: Awaited<ReturnType<typeof projectRecord>>,
  projectId: string,
): StoredActuals | null {
  if (!record) return null;
  return {
    projectId,
    domain: record.domain,
    actualWeeks: record.actualWeeks,
    actualTeamSize: record.actualTeamSize,
    scopeAccuracy: record.scopeAccuracy,
    note: "",
    modules: record.modules.map((m) => ({
      name: "",
      estimatedSize: m.estimatedSize,
      actualSize: m.actualSize,
      actualSprints: m.actualSprints,
    })),
    estimatedSprints: record.estimatedSprints,
    estimatedPoints: record.estimatedPoints,
    estimatedTeamSize: record.estimatedTeamSize,
    estimatedVelocity: record.estimatedVelocity,
    domainMultiplier: record.domainMultiplier,
    recordedAt: record.recordedAt.getTime(),
  };
}
