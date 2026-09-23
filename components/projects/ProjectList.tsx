"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink, Search, Trash2 } from "lucide-react";
import type { ProjectSummary } from "@/lib/projects/list";
import { cn } from "@/lib/utils";

/**
 * The projects list: search, open, duplicate, delete.
 *
 * Search filters what the page already loaded, so typing is instant; the
 * server route (`/api/projects?q=`) does the same filter for a list longer
 * than one page. Delete asks once, because it is a hard delete: the rounds,
 * the versions, the approvals and every share link go with it.
 */

const STATUS_TONE: Record<string, string> = {
  finalized: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  ready:
    "border-[var(--color-blueprint-accent)]/40 bg-[var(--color-blueprint-accent)]/10 text-[var(--color-blueprint-accent)]",
  error: "border-red-500/40 bg-red-500/10 text-red-300",
  needs_input: "border-amber-400/40 bg-amber-400/10 text-amber-300",
};

const WHEN = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

export function ProjectList({
  projects,
}: {
  projects: ProjectSummary[];
}): React.ReactElement {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.title.toLowerCase().includes(q));
  }, [projects, query]);

  function duplicate(id: string): void {
    startTransition(async () => {
      const res = await fetch(`/api/projects/${id}/duplicate`, { method: "POST" });
      if (res.ok) router.refresh();
    });
  }

  function remove(id: string): void {
    startTransition(async () => {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      setConfirming(null);
      if (res.ok) router.refresh();
    });
  }

  if (projects.length === 0) {
    return (
      <div className="border-blueprint-line/20 text-blueprint-muted rounded-2xl border bg-white/[0.02] p-8 text-center text-sm">
        No scopes yet.{" "}
        <Link
          href="/chat"
          className="text-[var(--color-blueprint-accent)] underline decoration-dotted underline-offset-4"
        >
          Start one
        </Link>
        .
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="border-blueprint-line/25 flex items-center gap-2 rounded-xl border bg-white/[0.03] px-3 py-2">
        <Search size={14} className="text-blueprint-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search scopes"
          aria-label="Search scopes"
          className="text-blueprint-text w-full bg-transparent text-sm focus:outline-none"
        />
      </label>

      <ul className="flex flex-col gap-2">
        {shown.map((project) => (
          <li
            key={project.id}
            className="border-blueprint-line/15 flex flex-col gap-3 rounded-xl border bg-white/[0.02] p-4 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1">
              <Link
                href={
                  project.hasOutput ? `/output/${project.id}` : `/chat?id=${project.id}`
                }
                className="text-blueprint-text block truncate font-medium hover:text-[var(--color-blueprint-accent)]"
              >
                {project.title}
              </Link>
              <p className="text-blueprint-muted mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                <span>Updated {WHEN.format(project.updatedAt)}</span>
                <span className="tabular-nums">{project.confidence}/100</span>
                {project.rawInputDeleted && (
                  <span title="The client's original text was removed by the retention policy">
                    original text removed
                  </span>
                )}
              </p>
            </div>

            <span
              className={cn(
                "shrink-0 self-start rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.18em] uppercase sm:self-auto",
                STATUS_TONE[project.status] ??
                  "border-blueprint-line/30 bg-blueprint-line/5 text-blueprint-muted",
              )}
            >
              {project.status.replace("_", " ")}
            </span>

            <div className="flex shrink-0 items-center gap-1">
              <Link
                href={
                  project.hasOutput ? `/output/${project.id}` : `/chat?id=${project.id}`
                }
                aria-label={`Open ${project.title}`}
                className="border-blueprint-line/25 text-blueprint-muted hover:text-blueprint-text inline-flex h-8 w-8 items-center justify-center rounded-lg border"
              >
                <ExternalLink size={13} />
              </Link>
              <button
                type="button"
                onClick={() => duplicate(project.id)}
                disabled={busy}
                aria-label={`Duplicate ${project.title}`}
                className="border-blueprint-line/25 text-blueprint-muted hover:text-blueprint-text inline-flex h-8 w-8 items-center justify-center rounded-lg border disabled:opacity-40"
              >
                <Copy size={13} />
              </button>
              <button
                type="button"
                onClick={() =>
                  confirming === project.id
                    ? remove(project.id)
                    : setConfirming(project.id)
                }
                onBlur={() => setConfirming((id) => (id === project.id ? null : id))}
                disabled={busy}
                aria-label={
                  confirming === project.id
                    ? `Confirm deleting ${project.title}`
                    : `Delete ${project.title}`
                }
                className={cn(
                  "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border px-2 text-[11px] disabled:opacity-40",
                  confirming === project.id
                    ? "border-red-500/50 bg-red-500/10 text-red-300"
                    : "border-blueprint-line/25 text-blueprint-muted hover:text-red-300",
                )}
              >
                <Trash2 size={13} />
                {confirming === project.id && "Delete for good?"}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {shown.length === 0 && (
        <p className="text-blueprint-muted text-sm">Nothing matches “{query}”.</p>
      )}
    </div>
  );
}
