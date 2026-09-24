"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Check,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { gsap, useGSAP, ScrollTrigger } from "@/lib/gsap-init";

void ScrollTrigger;
import {
  ApiError,
  deleteProject,
  patchFinalOutput,
  renameProject,
} from "@/lib/api/client";
import type { FinalOutput } from "@/lib/schemas/output";
import { SCOPING } from "@/lib/config/scoping";
import { useUnsavedChanges } from "@/lib/hooks/useUnsavedChanges";
import { clearDraft, readDraft, sameOutput, writeDraft } from "@/lib/output/draft-store";
import { ConfidenceBadge } from "@/components/output/ConfidenceBadge";
import { ClarifyPanel } from "@/components/output/ClarifyPanel";
import { ClientView } from "@/components/output/ClientView";
import { EngineerView } from "@/components/output/EngineerView";
import { ExportMenu } from "@/components/output/ExportMenu";
import { ShareDialog } from "@/components/output/ShareDialog";
import { cn } from "@/lib/utils";

type Tab = "client" | "engineer";

/** How often unsaved edits are written to this browser (UX-02). */
const AUTOSAVE_MS = 10_000;

const LEAVE_WARNING =
  "You have unsaved changes to this scope. Leave the page and lose them?";

const WHEN = new Intl.DateTimeFormat("en-GB", { timeStyle: "short" });

interface OutputLayoutProps {
  sessionId: string;
  initialOutput: FinalOutput;
  initialTitle: string;
}

const TOC: Record<Tab, ReadonlyArray<{ id: string; label: string }>> = {
  client: [
    { id: "summary", label: "Summary" },
    { id: "modules", label: "Modules" },
    { id: "candidates", label: "Candidates" },
    { id: "milestones", label: "Milestones" },
    { id: "assumptions", label: "Assumptions" },
    { id: "open-items", label: "Open items" },
  ],
  engineer: [
    { id: "effort", label: "Effort" },
    { id: "modules", label: "Modules" },
    { id: "build-order", label: "Build order" },
    { id: "database", label: "Database" },
    { id: "auth", label: "Auth & RBAC" },
    { id: "third-party", label: "Third-party" },
    { id: "sprints", label: "Sprints" },
    { id: "testing", label: "Testing" },
    { id: "security", label: "Security" },
    { id: "risks", label: "Risks" },
    { id: "github", label: "GitHub" },
  ],
};

export function OutputLayout({
  sessionId,
  initialOutput,
  initialTitle,
}: OutputLayoutProps): React.ReactElement {
  const root = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("client");
  const [draft, setDraft] = useState<FinalOutput>(initialOutput);
  const [serverCopy, setServerCopy] = useState<FinalOutput>(initialOutput);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [clarifying, setClarifying] = useState<string | null>(null);
  const [autosavedAt, setAutosavedAt] = useState<number | null>(null);
  // A draft this browser kept from a previous visit, offered rather than
  // applied: it may be someone else's tab, or an edit they abandoned. Read
  // after mount, never during render — the server has no localStorage, and a
  // banner that exists on one side only is a hydration mismatch.
  const [recovered, setRecovered] = useState<ReturnType<typeof readDraft>>(null);

  const [title, setTitle] = useState(initialTitle);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(initialTitle);
  const [titleError, setTitleError] = useState<string | null>(null);

  // GSAP-powered scroll-reveal for every output section + initial entrance.
  useGSAP(
    () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) return;

      gsap.from("[data-out-topbar]", {
        y: -16,
        opacity: 0,
        duration: 0.55,
        ease: "scopeai-out",
      });

      const sections = root.current?.querySelectorAll<HTMLElement>("section[id]");
      sections?.forEach((s) => {
        gsap.from(s, {
          opacity: 0,
          y: 24,
          duration: 0.7,
          ease: "scopeai-out",
          scrollTrigger: {
            trigger: s,
            start: "top 85%",
            toggleActions: "play none none none",
          },
        });
      });
    },
    { scope: root, dependencies: [tab] },
  );

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(serverCopy),
    [draft, serverCopy],
  );

  const { guardNavigation } = useUnsavedChanges(dirty, LEAVE_WARNING);

  // Esc cancels edit-mode if no changes are pending.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape" && editing && !dirty) setEditing(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, dirty]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // After the commit, so this is not a setState during render.
      await Promise.resolve();
      if (cancelled) return;
      const stored = readDraft(sessionId);
      if (stored && !sameOutput(stored.output, initialOutput)) setRecovered(stored);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, initialOutput]);

  // Autosave, to this browser only — see lib/output/draft-store.
  const latest = useRef(draft);
  useEffect(() => {
    latest.current = draft;
  }, [draft]);
  useEffect(() => {
    if (!dirty) return;
    const timer = setInterval(() => {
      writeDraft(sessionId, latest.current);
      setAutosavedAt(Date.now());
    }, AUTOSAVE_MS);
    return () => clearInterval(timer);
  }, [dirty, sessionId]);

  async function handleSave(): Promise<void> {
    setSaving(true);
    setSaveError(null);
    try {
      const updatedSession = await patchFinalOutput(sessionId, draft);
      const next = updatedSession.final_output ?? draft;
      setServerCopy(next);
      setDraft(next);
      setEditing(false);
      // The server now holds it, so the local copy is only noise.
      clearDraft(sessionId);
      setAutosavedAt(null);
      setRecovered(null);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save edits.");
    } finally {
      setSaving(false);
    }
  }

  function handleResetTab(): void {
    if (tab === "client") {
      setDraft({ ...draft, client: serverCopy.client });
    } else {
      setDraft({ ...draft, engineer: serverCopy.engineer });
    }
  }

  function handleCancelEdit(): void {
    setDraft(serverCopy);
    setEditing(false);
    setSaveError(null);
    clearDraft(sessionId);
    setAutosavedAt(null);
  }

  async function handleRename(next: string): Promise<void> {
    const wanted = next.trim();
    setTitleEditing(false);
    if (!wanted || wanted === title) return;
    const previous = title;
    setTitle(wanted); // Optimistic: the rename is a one-field write.
    setTitleError(null);
    try {
      setTitle(await renameProject(sessionId, wanted));
    } catch (err) {
      setTitle(previous);
      setTitleDraft(previous);
      setTitleError(
        err instanceof ApiError ? err.message : "Could not save the new title.",
      );
    }
  }

  async function handleDelete(): Promise<void> {
    // Hard delete, and the share links stop resolving with it (PRIV-01), so
    // it is worth one plain question first.
    const sure = window.confirm(
      `Delete “${title}” for good? Its versions, approvals and share links go with it. This cannot be undone.`,
    );
    if (!sure) return;
    setSaveError(null);
    try {
      await deleteProject(sessionId);
      clearDraft(sessionId);
      router.push("/projects");
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not delete this.");
    }
  }

  // Blueprint step 12's threshold, applied to the document on screen: a
  // scope generated with "Generate anyway" carries a score below it.
  const lowConfidence = draft.client.confidence_badge.score < SCOPING.confidenceThreshold;

  return (
    <div ref={root} className="bg-blueprint-bg min-h-[100dvh]">
      {/* Top bar */}
      <header
        data-out-topbar
        className="border-blueprint-line/15 bg-blueprint-bg/85 sticky top-0 z-20 border-b backdrop-blur-md"
      >
        {/* Row 1 — back · title (truncates) · confidence badge */}
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 pt-3 sm:px-6">
          <Link
            href="/projects"
            aria-label="Back to your scopes"
            onNavigate={guardNavigation}
            className="text-blueprint-muted hover:text-blueprint-text inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
          >
            <ArrowLeft size={16} />
          </Link>
          <div className="flex min-w-0 flex-1 items-center">
            {titleEditing ? (
              <input
                autoFocus
                value={titleDraft}
                maxLength={120}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => void handleRename(titleDraft)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void handleRename(titleDraft);
                  } else if (e.key === "Escape") {
                    setTitleDraft(title);
                    setTitleEditing(false);
                  }
                }}
                aria-label="Project title"
                className="border-blueprint-line/30 bg-blueprint-bg/50 text-blueprint-text w-full min-w-0 rounded-md border px-2 py-1 text-base font-semibold outline-none focus-visible:border-[var(--color-blueprint-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-blueprint-accent)]/40"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setTitleDraft(title);
                  setTitleEditing(true);
                }}
                className="text-blueprint-text flex max-w-full min-w-0 items-center gap-1.5 text-base font-semibold sm:text-lg"
                aria-label="Edit project title"
                title={title}
              >
                <span className="truncate">{title}</span>
                <Pencil size={12} className="text-blueprint-muted shrink-0" />
              </button>
            )}
          </div>
          <div className="shrink-0">
            <ConfidenceBadge badge={draft.client.confidence_badge} size="sm" />
          </div>
        </div>

        {/* Row 2 — action buttons, right-aligned, own row so they never
            collide with a long title. Horizontal-scrolls on tiny screens. */}
        <div className="mx-auto flex max-w-7xl items-center justify-end gap-2 overflow-x-auto px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={handleResetTab}
                  className="text-blueprint-muted hover:text-blueprint-text border-blueprint-line/30 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs"
                >
                  <RefreshCw size={12} />
                  Reset {tab}
                </button>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="text-blueprint-muted hover:text-blueprint-text border-blueprint-line/30 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs"
                >
                  <X size={12} />
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!dirty || saving}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium",
                    dirty && !saving
                      ? "border-[var(--color-blueprint-accent)] bg-[var(--color-blueprint-accent)]/15 text-[var(--color-blueprint-accent)] hover:bg-[var(--color-blueprint-accent)]/25"
                      : "border-blueprint-line/20 text-blueprint-muted cursor-not-allowed",
                  )}
                >
                  {saving ? (
                    <Loader2 className="animate-spin" size={12} />
                  ) : (
                    <Save size={12} />
                  )}
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-blueprint-text border-blueprint-line/30 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs hover:border-[var(--color-blueprint-accent)]/50"
              >
                <Pencil size={12} />
                Edit
              </button>
            )}
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-400/20"
            >
              <Check size={12} />
              Approve & share
            </button>
            <button
              type="button"
              onClick={() => void handleDelete()}
              className="text-blueprint-muted border-blueprint-line/30 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs hover:border-red-400/50 hover:text-red-300"
            >
              <Trash2 size={12} />
              Delete
            </button>
            <ExportMenu
              output={draft}
              projectId={sessionId}
              activeTab={tab}
              printTargetId="output-print-target"
              onShare={() => setShareOpen(true)}
            />
          </div>
        </div>

        <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 sm:px-6">
          <TabButton active={tab === "client"} onClick={() => setTab("client")}>
            Client View
          </TabButton>
          <TabButton active={tab === "engineer"} onClick={() => setTab("engineer")}>
            Engineer View
          </TabButton>
        </div>
        {(saveError ?? titleError) && (
          <p className="border-red-500/30 bg-red-500/10 px-6 py-2 text-xs text-red-300">
            {saveError ?? titleError}
          </p>
        )}
        {dirty && (
          <p
            className="text-blueprint-muted px-6 py-1.5 text-[11px]"
            aria-live="polite"
            data-testid="unsaved-notice"
          >
            {autosavedAt
              ? `Unsaved changes — kept in this browser at ${WHEN.format(autosavedAt)}.`
              : "Unsaved changes."}
          </p>
        )}
      </header>

      {lowConfidence && (
        <div
          role="status"
          data-testid="low-confidence-banner"
          className="mx-auto mt-6 flex max-w-7xl items-start gap-3 rounded-xl border border-amber-400/40 bg-amber-400/5 px-4 py-3 text-sm text-amber-300 sm:px-6"
        >
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          <p className="leading-relaxed">
            <span className="font-semibold">Low confidence draft.</span> This scope was
            generated before the questions were finished — confidence is{" "}
            {draft.client.confidence_badge.score}/100, below the threshold of{" "}
            {SCOPING.confidenceThreshold}. Treat the estimates as a starting point, and
            answer the open items below to firm it up.
          </p>
        </div>
      )}

      {recovered && (
        <div
          role="status"
          data-testid="recovered-draft"
          className="mx-auto mt-6 flex max-w-7xl flex-wrap items-center gap-3 rounded-xl border border-[var(--color-blueprint-accent)]/40 bg-[var(--color-blueprint-accent)]/5 px-4 py-3 text-sm sm:px-6"
        >
          <span className="text-blueprint-text">
            Unsaved edits from {WHEN.format(recovered.savedAt)} are still in this browser.
          </span>
          <button
            type="button"
            onClick={() => {
              setDraft(recovered.output);
              setEditing(true);
              setRecovered(null);
            }}
            className="rounded-full border border-[var(--color-blueprint-accent)] px-3 py-1 text-xs font-medium text-[var(--color-blueprint-accent)]"
          >
            Restore them
          </button>
          <button
            type="button"
            onClick={() => {
              clearDraft(sessionId);
              setRecovered(null);
            }}
            className="text-blueprint-muted hover:text-blueprint-text border-blueprint-line/30 rounded-full border px-3 py-1 text-xs"
          >
            Discard
          </button>
        </div>
      )}

      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_220px]">
        <div id="output-print-target" className="min-w-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              {tab === "client" ? (
                <ClientView
                  view={draft.client}
                  readOnly={!editing}
                  sessionId={sessionId}
                  onChange={(client) => setDraft((d) => ({ ...d, client }))}
                  onClarify={(question) => setClarifying(question)}
                />
              ) : (
                <EngineerView
                  view={draft.engineer}
                  readOnly={!editing}
                  onChange={(engineer) => setDraft((d) => ({ ...d, engineer }))}
                  checklistKey={sessionId}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Sticky TOC */}
        <aside className="hidden lg:block">
          <nav
            aria-label="Table of contents"
            className="border-blueprint-line/15 sticky top-32 flex flex-col gap-1 rounded-xl border bg-white/[0.02] p-3 backdrop-blur-md"
          >
            <p className="text-blueprint-muted px-2 pb-2 font-mono text-[10px] tracking-[0.18em] uppercase">
              Sections
            </p>
            {TOC[tab].map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="text-blueprint-muted hover:bg-blueprint-line/10 hover:text-blueprint-text rounded-md px-2 py-1.5 text-sm"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </aside>
      </div>

      <ShareDialog
        open={shareOpen}
        sessionId={sessionId}
        title={title}
        onClose={() => setShareOpen(false)}
      />

      {clarifying !== null && (
        <ClarifyPanel
          sessionId={sessionId}
          question={clarifying}
          hasUnsavedEdits={dirty}
          onClose={() => setClarifying(null)}
          onApplied={(output) => {
            setServerCopy(output);
            setDraft(output);
            setEditing(false);
            clearDraft(sessionId);
          }}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick(): void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative px-3 py-2 text-sm"
      aria-pressed={active}
    >
      <span className={cn(active ? "text-blueprint-text" : "text-blueprint-muted")}>
        {children}
      </span>
      {active && (
        <motion.span
          layoutId="output-tab-underline"
          className="absolute right-0 bottom-0 left-0 h-0.5 bg-[var(--color-blueprint-accent)]"
        />
      )}
    </button>
  );
}
