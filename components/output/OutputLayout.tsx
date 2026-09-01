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
  X,
} from "lucide-react";
import { gsap, useGSAP, ScrollTrigger } from "@/lib/gsap-init";

void ScrollTrigger;
import {
  ApiError,
  patchFinalOutput,
} from "@/lib/api/client";
import type { FinalOutput } from "@/lib/schemas/output";
import { ConfidenceBadge } from "@/components/output/ConfidenceBadge";
import { ClientView } from "@/components/output/ClientView";
import { EngineerView } from "@/components/output/EngineerView";
import { ExportMenu } from "@/components/output/ExportMenu";
import { ShareDialog } from "@/components/output/ShareDialog";
import { cn } from "@/lib/utils";

type Tab = "client" | "engineer";

interface OutputLayoutProps {
  sessionId: string;
  initialOutput: FinalOutput;
  initialTitle: string;
}

const TOC: Record<Tab, ReadonlyArray<{ id: string; label: string }>> = {
  client: [
    { id: "summary", label: "Summary" },
    { id: "modules", label: "Modules" },
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
  const [tab, setTab] = useState<Tab>("client");
  const [draft, setDraft] = useState<FinalOutput>(initialOutput);
  const [serverCopy, setServerCopy] = useState<FinalOutput>(initialOutput);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const [title, setTitle] = useState(initialTitle);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(initialTitle);

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

  // Esc cancels edit-mode if no changes are pending.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape" && editing && !dirty) setEditing(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, dirty]);

  async function handleSave(): Promise<void> {
    setSaving(true);
    setSaveError(null);
    try {
      const updatedSession = await patchFinalOutput(sessionId, draft);
      const next = updatedSession.final_output ?? draft;
      setServerCopy(next);
      setDraft(next);
      setEditing(false);
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Could not save edits.",
      );
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
  }

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
            href="/chat"
            aria-label="Back to chat"
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
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = titleDraft.trim();
                    if (v) setTitle(v);
                    setTitleEditing(false);
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
                className="text-blueprint-text flex min-w-0 max-w-full items-center gap-1.5 text-base font-semibold sm:text-lg"
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
                  className="text-blueprint-muted hover:text-blueprint-text inline-flex items-center gap-1.5 rounded-full border border-blueprint-line/30 px-3 py-1.5 text-xs"
                >
                  <RefreshCw size={12} />
                  Reset {tab}
                </button>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="text-blueprint-muted hover:text-blueprint-text inline-flex items-center gap-1.5 rounded-full border border-blueprint-line/30 px-3 py-1.5 text-xs"
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
                className="text-blueprint-text border-blueprint-line/30 hover:border-[var(--color-blueprint-accent)]/50 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs"
              >
                <Pencil size={12} />
                Edit
              </button>
            )}
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="border-emerald-400/40 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium"
            >
              <Check size={12} />
              Approve & share
            </button>
            <ExportMenu
              output={draft}
              activeTab={tab}
              printTargetId="output-print-target"
              onShare={() => setShareOpen(true)}
            />
          </div>
        </div>

        <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 sm:px-6">
          <TabButton
            active={tab === "client"}
            onClick={() => setTab("client")}
          >
            Client View
          </TabButton>
          <TabButton
            active={tab === "engineer"}
            onClick={() => setTab("engineer")}
          >
            Engineer View
          </TabButton>
        </div>
        {saveError && (
          <p className="border-red-500/30 bg-red-500/10 px-6 py-2 text-xs text-red-300">
            {saveError}
          </p>
        )}
      </header>

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
                  onChange={(client) =>
                    setDraft((d) => ({ ...d, client }))
                  }
                />
              ) : (
                <EngineerView
                  view={draft.engineer}
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
        onClose={() => setShareOpen(false)}
      />
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
      <span
        className={cn(
          active ? "text-blueprint-text" : "text-blueprint-muted",
        )}
      >
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
