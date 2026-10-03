import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { getViewerFromCookies } from "@/lib/auth/viewer";
import { getDatabase } from "@/lib/db/client";
import { projects, workspaceMembers, workspaces } from "@/lib/db/schema";
import {
  averageAbsoluteError,
  calibrationSentence,
  compareRecords,
  computeFactors,
  errorTrend,
  MIN_PROJECTS,
  type CalibrationFactor,
} from "@/lib/calibration/factors";
import { sharedPool, workspaceRecords } from "@/lib/calibration/store";
import {
  EstimateVsActualChart,
  ErrorTrendChart,
} from "@/components/analytics/EstimateChart";
import { ShareCalibrationToggle } from "@/components/analytics/ShareCalibrationToggle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Estimate accuracy — Aureon",
  robots: { index: false },
};

/**
 * How the estimates are doing: what was predicted, what it took, and what
 * that means for the next estimate (the calibration loop).
 *
 * Everything here is this workspace's own data. The shared pool, when the
 * workspace has opted into it, appears only as counts and ratios.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}): Promise<React.ReactElement> {
  const viewer = await getViewerFromCookies();
  if (!viewer.userId) return <SignedOut />;

  const db = getDatabase();
  // Every workspace this person belongs to, not just the first one: the
  // page used to pick memberships[0] and say nothing about the rest.
  const memberships = await db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, viewer.userId))
    .orderBy(workspaces.name);
  if (memberships.length === 0) return <Empty />;

  const asked = (await searchParams).workspace;
  // An id in the URL is honoured only if this person is in that workspace.
  const chosen = memberships.find((m) => m.id === asked) ?? memberships[0]!;
  const workspaceId = chosen.id;

  const [workspace] = await db
    .select({ name: workspaces.name, shareCalibration: workspaces.shareCalibration })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  const records = await workspaceRecords(workspaceId);
  const comparisons = compareRecords(records);
  const factors = computeFactors(records);
  const shared = workspace?.shareCalibration
    ? computeFactors(await sharedPool(workspaceId))
    : null;

  const titles = await titlesFor(comparisons.map((c) => c.projectId));
  const averageError = averageAbsoluteError(comparisons);
  const trend = errorTrend(comparisons);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-12 sm:py-16">
      <header className="flex flex-col gap-2">
        <Link
          href="/projects"
          className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase hover:text-[var(--color-blueprint-accent)]"
        >
          ← Your scopes
        </Link>
        <h1 className="text-blueprint-text font-display text-3xl font-bold sm:text-4xl">
          Estimate accuracy
        </h1>
        {memberships.length > 1 && (
          <nav
            aria-label="Workspace"
            className="flex flex-wrap items-center gap-2 pt-1"
            data-testid="workspace-switcher"
          >
            {memberships.map((m) => (
              <Link
                key={m.id}
                href={`/analytics?workspace=${m.id}`}
                aria-current={m.id === workspaceId ? "page" : undefined}
                className={
                  m.id === workspaceId
                    ? "rounded-full border border-[var(--color-blueprint-accent)] bg-[var(--color-blueprint-accent)]/10 px-3 py-1 text-xs text-[var(--color-blueprint-accent)]"
                    : "border-blueprint-line/30 text-blueprint-muted hover:text-blueprint-text rounded-full border px-3 py-1 text-xs"
                }
              >
                {m.name}
              </Link>
            ))}
          </nav>
        )}
        <p className="text-blueprint-muted text-sm leading-relaxed">
          {records.length === 0
            ? "Nothing recorded yet. When a project finishes, open its version history and record what it actually took."
            : `${records.length} recorded project${records.length === 1 ? "" : "s"} in ${workspace?.name ?? "this workspace"}. ${
                factors.projects >= MIN_PROJECTS
                  ? "New estimates are being adjusted by them."
                  : `${MIN_PROJECTS - factors.projects} more and new estimates start being adjusted by them.`
              }`}
        </p>
      </header>

      {records.length > 0 && (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <Stat label="Recorded projects" value={String(records.length)} />
            <Stat
              label="Average absolute error"
              value={`${averageError}%`}
              hint="|actual − estimated| ÷ estimated"
            />
            <Stat
              label="Overall ratio"
              value={factors.overall ? `×${factors.overall.ratio}` : "—"}
              hint={
                factors.overall
                  ? factors.overall.ratio > 1
                    ? "Projects take longer than estimated"
                    : "Projects come in under the estimate"
                  : undefined
              }
            />
          </section>

          <section className="border-blueprint-line/20 rounded-2xl border bg-white/[0.02] p-5">
            <EstimateVsActualChart comparisons={comparisons} titles={titles} />
          </section>

          {trend.length > 1 && (
            <section className="border-blueprint-line/20 rounded-2xl border bg-white/[0.02] p-5">
              <ErrorTrendChart points={trend} />
            </section>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="text-blueprint-text font-display text-xl font-bold">
              Your calibration factors
            </h2>
            <p className="text-blueprint-muted text-sm leading-relaxed">
              A factor is what a kind of work actually cost, over what was estimated for
              it. One is only applied once {MIN_PROJECTS} projects stand behind it.
            </p>
            <FactorTable
              rows={[
                ...Object.entries(factors.byDomain).map(([key, factor]) => ({
                  label: `Domain: ${key}`,
                  factor,
                })),
                ...Object.entries(factors.bySize).map(([size, factor]) => ({
                  label: `Modules sized ${size.toLowerCase()}`,
                  factor: factor as CalibrationFactor,
                })),
              ]}
            />
          </section>
        </>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-blueprint-text font-display text-xl font-bold">
          Shared calibration
        </h2>
        <ShareCalibrationToggle
          workspaceId={workspaceId}
          enabled={workspace?.shareCalibration ?? false}
        />
        {shared && shared.projects > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-blueprint-muted text-sm">
              The pool currently holds {shared.projects} project
              {shared.projects === 1 ? "" : "s"} from other workspaces.
            </p>
            <FactorTable
              rows={Object.entries(shared.byDomain).map(([key, factor]) => ({
                label: `Domain: ${key}`,
                factor,
              }))}
            />
          </div>
        )}
      </section>
    </main>
  );
}

function FactorTable({
  rows,
}: {
  rows: Array<{ label: string; factor: CalibrationFactor }>;
}): React.ReactElement {
  if (rows.length === 0) {
    return (
      <p className="text-blueprint-muted text-sm">
        Nothing to show yet — factors appear as projects are recorded.
      </p>
    );
  }
  return (
    <div className="border-blueprint-line/20 overflow-x-auto rounded-xl border">
      <table className="w-full text-left text-sm">
        <thead className="text-blueprint-muted bg-blueprint-line/5 font-mono text-[10px] tracking-[0.18em] uppercase">
          <tr>
            <th className="px-4 py-3 font-medium">What</th>
            <th className="px-4 py-3 font-medium">Factor</th>
            <th className="px-4 py-3 font-medium">Projects</th>
            <th className="px-4 py-3 font-medium">Confidence</th>
            <th className="px-4 py-3 font-medium">Applied</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-blueprint-line/10 border-t">
              <td className="text-blueprint-text px-4 py-2">{row.label}</td>
              <td className="px-4 py-2 font-mono text-xs tabular-nums">
                ×{row.factor.ratio}
              </td>
              <td className="text-blueprint-muted px-4 py-2 font-mono text-xs tabular-nums">
                {row.factor.projects}
              </td>
              <td className="text-blueprint-muted px-4 py-2 text-xs">
                {row.factor.confidence}
              </td>
              <td className="px-4 py-2 text-xs">
                {row.factor.applicable ? (
                  <span className="text-emerald-300">yes</span>
                ) : (
                  <span className="text-blueprint-muted">
                    needs {MIN_PROJECTS - row.factor.projects} more
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}): React.ReactElement {
  return (
    <div className="border-blueprint-line/20 rounded-xl border bg-white/[0.02] p-4">
      <p className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase">
        {label}
      </p>
      <p className="text-blueprint-text font-display mt-1 text-2xl font-bold tabular-nums">
        {value}
      </p>
      {hint && <p className="text-blueprint-muted mt-1 text-[11px]">{hint}</p>}
    </div>
  );
}

function SignedOut(): React.ReactElement {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-20 text-center">
      <h1 className="text-blueprint-text font-display text-2xl font-bold">
        Estimate accuracy
      </h1>
      <p className="text-blueprint-muted text-sm">
        Calibration belongs to a workspace, so this page needs an account.
      </p>
      <Link
        href="/sign-in"
        className="mx-auto rounded-full border border-[var(--color-blueprint-accent)] px-5 py-2.5 text-sm text-[var(--color-blueprint-accent)]"
      >
        Sign in
      </Link>
    </main>
  );
}

function Empty(): React.ReactElement {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-20 text-center">
      <h1 className="text-blueprint-text font-display text-2xl font-bold">
        Estimate accuracy
      </h1>
      <p className="text-blueprint-muted text-sm">
        No workspace yet. Create a scope and it will make one for you.
      </p>
    </main>
  );
}

/** Titles for the chart, from the projects the comparisons name. */
async function titlesFor(projectIds: string[]): Promise<Record<string, string>> {
  if (projectIds.length === 0) return {};
  const rows = await getDatabase()
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(inArray(projects.id, projectIds));
  return Object.fromEntries(rows.map((row) => [row.id, row.title]));
}

/** Exported for the tests that check the sentence the panel shows. */
export { calibrationSentence };
