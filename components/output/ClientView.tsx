"use client";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import { useState } from "react";
import { ChevronDown, MessageSquare } from "lucide-react";
import Link from "next/link";
import { ConfidenceBadge } from "@/components/output/ConfidenceBadge";
import { ModuleCard } from "@/components/output/ModuleCard";
import { SectionEditor } from "@/components/output/SectionEditor";
import type {
  ClientView as ClientViewData,
  ClientModule,
  Milestone,
} from "@/lib/schemas/output";
import { cn } from "@/lib/utils";

interface ClientViewProps {
  view: ClientViewData;
  readOnly?: boolean;
  sessionId?: string;
  onChange?(next: ClientViewData): void;
}

function Section({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <motion.section
      id={id}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className={cn("scroll-mt-28", className)}
    >
      <h2 className="text-blueprint-text font-display mb-5 text-2xl font-bold sm:text-3xl">
        {title}
      </h2>
      {children}
    </motion.section>
  );
}

export function ClientView({
  view,
  readOnly,
  sessionId,
  onChange,
}: ClientViewProps): React.ReactElement {
  const update = (next: Partial<ClientViewData>): void => {
    if (onChange) onChange({ ...view, ...next });
  };

  return (
    <div className="flex flex-col gap-12">
      <Section id="summary" title="Summary">
        <header className="mb-4 flex flex-wrap items-center gap-3">
          <ConfidenceBadge badge={view.confidence_badge} size="lg" />
        </header>
        <SectionEditor
          ariaLabel="Project summary"
          value={view.project_summary}
          multiline
          maxLength={1000}
          disabled={readOnly}
          onConfirm={(next) => update({ project_summary: next })}
          className="text-blueprint-text/95 max-w-3xl text-base sm:text-lg"
        />
      </Section>

      <Section id="modules" title="Modules">
        {readOnly ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {view.modules.map((m, i) => (
              <ReadOnlyModuleCard key={`${m.name}-${i}`} module={m} />
            ))}
          </div>
        ) : (
          <Reorder.Group
            axis="y"
            values={view.modules}
            onReorder={(modules: ClientModule[]) => update({ modules })}
            className="grid grid-cols-1 gap-4 md:grid-cols-2"
          >
            {view.modules.map((m, i) => (
              <ModuleCard
                key={`${m.name}-${i}`}
                module={m}
                onChange={(next) => {
                  const updated = view.modules.map((x) => (x === m ? next : x));
                  update({ modules: updated });
                }}
              />
            ))}
          </Reorder.Group>
        )}
      </Section>

      <Section id="milestones" title="Milestones">
        <div className="-mx-6 overflow-x-auto px-6 pb-2">
          <ol className="flex min-w-max items-stretch gap-4">
            {view.milestones.map((ms: Milestone, i) => (
              <li
                key={`${ms.phase}-${i}`}
                className="border-blueprint-line/20 flex w-72 shrink-0 flex-col gap-3 rounded-xl border bg-white/[0.025] p-5 backdrop-blur-md"
              >
                <span className="text-blueprint-accent font-mono text-[10px] tracking-[0.18em] uppercase">
                  {ms.phase}
                </span>
                <h3 className="text-blueprint-text font-display text-lg font-semibold">
                  {ms.name}
                </h3>
                <ul className="text-blueprint-muted flex flex-col gap-1.5 text-sm">
                  {ms.deliverables.map((d, j) => (
                    <li
                      key={j}
                      className="before:bg-blueprint-accent/60 relative pl-3 before:absolute before:top-2 before:left-0 before:h-1 before:w-1 before:rounded-full"
                    >
                      {d}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      <CollapsibleSection
        id="assumptions"
        title="What we assumed"
        items={view.assumptions}
        empty="No assumptions — every parameter was explicitly stated."
      />

      <Section id="open-items" title="Open items">
        {view.open_items.length === 0 ? (
          <p className="text-blueprint-muted text-sm">Nothing outstanding.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {view.open_items.map((q, i) => (
              <li
                key={i}
                className="border-blueprint-line/20 flex items-start justify-between gap-3 rounded-lg border bg-white/[0.02] p-4 backdrop-blur-md"
              >
                <span className="text-blueprint-text/95 text-sm">{q}</span>
                {!readOnly && sessionId && (
                  <Link
                    href={`/chat?s=${sessionId}`}
                    className="text-blueprint-accent inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-blueprint-accent)]/30 px-2.5 py-1 text-xs hover:bg-[var(--color-blueprint-accent)]/15"
                  >
                    <MessageSquare size={12} />
                    Clarify
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function CollapsibleSection({
  id,
  title,
  items,
  empty,
}: {
  id: string;
  title: string;
  items: string[];
  empty: string;
}): React.ReactElement {
  const [open, setOpen] = useState(items.length <= 6);
  return (
    <Section id={id} title={title}>
      {items.length === 0 ? (
        <p className="text-blueprint-muted text-sm">{empty}</p>
      ) : (
        <div className="border-blueprint-line/20 rounded-xl border bg-white/[0.02] backdrop-blur-md">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex w-full items-center justify-between p-4 text-left"
          >
            <span className="text-blueprint-text text-sm font-medium">
              {items.length} item{items.length === 1 ? "" : "s"}
            </span>
            <motion.span animate={{ rotate: open ? 180 : 0 }}>
              <ChevronDown size={16} className="text-blueprint-muted" />
            </motion.span>
          </button>
          <AnimatePresence initial={false}>
            {open && (
              <motion.ul
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="border-blueprint-line/15 flex flex-col gap-2 border-t px-4 py-4 text-sm">
                  {items.map((it, i) => (
                    <li key={i} className="text-blueprint-muted">
                      {it}
                    </li>
                  ))}
                </div>
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}
    </Section>
  );
}

function ReadOnlyModuleCard({ module }: { module: ClientModule }): React.ReactElement {
  return (
    <div className="border-blueprint-line/20 flex flex-col gap-3 rounded-xl border bg-white/[0.025] p-5 backdrop-blur-md">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-blueprint-text font-display text-lg font-bold">
          {module.name}
        </h3>
        <span className="border-blueprint-line/30 text-blueprint-muted shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.18em] uppercase">
          {module.size.toLowerCase()}
        </span>
      </div>
      <p className="text-blueprint-muted text-sm leading-relaxed">{module.description}</p>
    </div>
  );
}
