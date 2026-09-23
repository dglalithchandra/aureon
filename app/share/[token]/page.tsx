import { notFound } from "next/navigation";
import { isShareToken, resolveShareToken } from "@/lib/storage/share";
import { ReadOnlyOutput } from "@/components/output/ReadOnlyOutput";
import { ApprovalPanel } from "@/components/output/ApprovalPanel";
import { getVersionById } from "@/lib/versions/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<{ title: string; robots: { index: false } }> {
  await params;
  return {
    title: "Shared scope — Aureon",
    robots: { index: false },
  };
}

const SNAPSHOT_DATE = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
  timeZone: "UTC",
});

/**
 * A shared scope, rendered only from the snapshot stored when it was shared
 * (BUG-04): it does not depend on the 24 h session, and a revoked or expired
 * link is a 404.
 */
export default async function SharePage({
  params,
}: PageProps): Promise<React.ReactElement> {
  const { token } = await params;
  if (!isShareToken(token)) notFound();

  const snapshot = await resolveShareToken(token);
  if (!snapshot) notFound();

  // An approval link names the version it is asking about (step 13); the
  // page shows the decision panel and, once decided, the lock.
  const approval = snapshot.mode === "approval";
  const version = snapshot.version_id ? await getVersionById(snapshot.version_id) : null;

  return (
    <main className="bg-blueprint-bg min-h-screen">
      <div className="mx-auto w-full max-w-6xl px-6 py-10 sm:px-8">
        <header className="border-blueprint-line/15 mb-8 flex flex-col gap-2 border-b pb-6">
          <p className="text-blueprint-muted font-mono text-[10px] tracking-[0.3em] uppercase">
            {approval
              ? "Aureon · for your approval"
              : "Aureon · shared scope · read-only"}
          </p>
          <h1 className="text-blueprint-text font-display text-3xl font-bold sm:text-4xl">
            {snapshot.title}
          </h1>
          <p className="text-blueprint-muted text-sm">
            Snapshot taken {SNAPSHOT_DATE.format(snapshot.created_at)}.{" "}
            {approval
              ? "This is the version you are being asked to approve."
              : "Re-share to include later edits."}
          </p>
          {version?.lockedAt && (
            <p className="text-sm font-medium text-emerald-300">
              {version.label ?? `Approved v${version.versionNumber}`}
              {version.approvedBy ? ` · by ${version.approvedBy}` : ""}
            </p>
          )}
        </header>

        <ReadOnlyOutput output={snapshot.final_output} />

        {approval && (
          <div className="mt-10">
            <ApprovalPanel
              token={token}
              versionNumber={snapshot.version_number}
              approvedLabel={version?.lockedAt ? (version.label ?? null) : null}
            />
          </div>
        )}
      </div>
    </main>
  );
}
