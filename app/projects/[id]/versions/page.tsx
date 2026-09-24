import Link from "next/link";
import { notFound } from "next/navigation";
import { can, loadAccessSubject, roleFor } from "@/lib/auth/access";
import { getViewerFromCookies } from "@/lib/auth/viewer";
import { getSession } from "@/lib/storage/session";
import { attributeDiff, diffScopes } from "@/lib/versions/diff";
import { getVersion, listVersions } from "@/lib/versions/store";
import { listApprovals } from "@/lib/versions/approval";
import { ScopeDiffView } from "@/components/output/ScopeDiffView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Version history — Aureon",
  robots: { index: false },
};

const WHEN = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

const REASON_LABEL: Record<string, string> = {
  generated: "Generated",
  clarified: "After clarification",
  edited: "Edited by hand",
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}

/**
 * Version history and the scope diff (blueprint step 14).
 *
 * Every version the project has, and what changed between any two of them —
 * chosen with the two selects, which are a plain GET form, so the comparison
 * is a URL you can send to someone.
 */
export default async function VersionsPage({
  params,
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const { id } = await params;
  const subject = await loadAccessSubject(id);
  if (!subject) notFound();

  const viewer = await getViewerFromCookies();
  if (!can(await roleFor(viewer, subject), "read")) notFound();

  const [versions, decisions] = await Promise.all([listVersions(id), listApprovals(id)]);
  const query = await searchParams;
  const numbers = versions.map((version) => version.versionNumber);
  const toNumber = Number(query.to) || numbers[numbers.length - 1] || 0;
  const fromNumber =
    Number(query.from) || numbers[Math.max(0, numbers.length - 2)] || toNumber;

  const [from, to] = await Promise.all([
    getVersion(id, fromNumber),
    getVersion(id, toNumber),
  ]);
  const session = await getSession(id);
  const comparable = from && to && from.versionNumber !== to.versionNumber;
  const diff = comparable ? diffScopes(from.output, to.output) : null;
  const attributed =
    diff && session ? attributeDiff(diff, session.rounds) : ([] as never[]);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-12 sm:py-16">
      <header className="flex flex-col gap-2">
        <Link
          href="/projects"
          className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase hover:text-[var(--color-blueprint-accent)]"
        >
          ← Your scopes
        </Link>
        <h1 className="text-blueprint-text font-display text-3xl font-bold sm:text-4xl">
          Version history
        </h1>
        <p className="text-blueprint-muted text-sm">
          {versions.length === 0
            ? "No versions yet. One is written every time the output is generated or an edit is saved."
            : `${versions.length} version${versions.length === 1 ? "" : "s"}. An approved version is locked and cannot change.`}
        </p>
      </header>

      {versions.length > 0 && (
        <ol className="flex flex-col gap-2">
          {[...versions].reverse().map((version) => (
            <li
              key={version.id}
              className="border-blueprint-line/15 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border bg-white/[0.02] px-4 py-3 text-sm"
            >
              <span className="text-blueprint-text font-display font-bold">
                v{version.versionNumber}
              </span>
              <span className="text-blueprint-muted">
                {REASON_LABEL[version.reason] ?? version.reason}
              </span>
              <span className="text-blueprint-muted text-xs">
                {WHEN.format(version.createdAt)}
              </span>
              <span className="text-blueprint-muted font-mono text-xs tabular-nums">
                {version.confidence}/100
              </span>
              {version.lockedAt && (
                <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-300">
                  {version.label ?? `Approved v${version.versionNumber}`}
                  {version.approvedBy ? ` · ${version.approvedBy}` : ""}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      {decisions.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-blueprint-text font-display text-xl font-bold">
            Client decisions
          </h2>
          {decisions.map((decision) => (
            <div
              key={decision.id}
              className={
                decision.state === "approved"
                  ? "rounded-xl border border-emerald-400/40 bg-emerald-400/5 px-4 py-3 text-sm"
                  : "rounded-xl border border-amber-400/40 bg-amber-400/5 px-4 py-3 text-sm"
              }
            >
              <p className="text-blueprint-text">
                <span className="font-medium">
                  {decision.state === "approved" ? "Approved" : "Changes requested"}
                </span>
                {decision.versionNumber ? ` · v${decision.versionNumber}` : ""} ·{" "}
                {decision.approverName ?? "someone"}
                {decision.decidedAt ? ` · ${WHEN.format(decision.decidedAt)}` : ""}
              </p>
              {decision.comment && (
                <p className="text-blueprint-muted mt-1 leading-relaxed">
                  “{decision.comment}”
                </p>
              )}
            </div>
          ))}
        </section>
      )}

      {versions.some((v) => v.lockedAt) && (
        // Approved, so the project can be compared against what happened
        // (the calibration loop).
        <Link
          href={`/projects/${id}/actuals`}
          className="border-blueprint-line/25 hover:border-blueprint-accent/50 text-blueprint-text flex flex-wrap items-center gap-2 rounded-xl border bg-white/[0.02] px-4 py-3 text-sm"
        >
          <span className="font-medium">Record actuals</span>
          <span className="text-blueprint-muted">
            what it really took, against what was estimated — five recorded projects start
            adjusting new estimates
          </span>
        </Link>
      )}

      {versions.length >= 2 && (
        <form
          method="get"
          className="border-blueprint-line/20 flex flex-wrap items-end gap-3 rounded-2xl border bg-white/[0.02] p-4"
        >
          <label className="flex flex-col gap-1">
            <span className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase">
              Compare
            </span>
            <select
              name="from"
              defaultValue={String(fromNumber)}
              className="border-blueprint-line/25 text-blueprint-text rounded-lg border bg-white/[0.03] px-3 py-2 text-sm"
            >
              {numbers.map((number) => (
                <option key={number} value={number}>
                  v{number}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase">
              With
            </span>
            <select
              name="to"
              defaultValue={String(toNumber)}
              className="border-blueprint-line/25 text-blueprint-text rounded-lg border bg-white/[0.03] px-3 py-2 text-sm"
            >
              {numbers.map((number) => (
                <option key={number} value={number}>
                  v{number}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-lg bg-[var(--color-blueprint-accent)] px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
          >
            Show changes
          </button>
        </form>
      )}

      {diff ? (
        <ScopeDiffView diff={diff} attributed={attributed} />
      ) : (
        versions.length >= 2 && (
          <p className="text-blueprint-muted text-sm">
            Pick two different versions to see what changed.
          </p>
        )
      )}
    </main>
  );
}
