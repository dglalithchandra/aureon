"use client";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import { useMemo, useState } from "react";
import { ChevronDown, MessageSquare, Plus, Trash2 } from "lucide-react";
import { ConfidenceBadge } from "@/components/output/ConfidenceBadge";
import { ModuleConfidenceChip, SeenInRepos } from "@/components/output/ModuleConfidence";
import { moduleLevel } from "@/lib/scoring/modules";
import { ModuleCard } from "@/components/output/ModuleCard";
import { SectionEditor } from "@/components/output/SectionEditor";
import { EditableList } from "@/components/output/EditableList";
import { CopyButton } from "@/components/output/CopyButton";
import {
  clientSections,
  moduleTableLines,
  sectionToMarkdown,
} from "@/lib/export/markdown";
import {
  moduleId,
  type ClientView as ClientViewData,
  type ClientModule,
  type Milestone,
} from "@/lib/schemas/output";
import { cn } from "@/lib/utils";

interface ClientViewProps {
  view: ClientViewData;
  readOnly?: boolean;
  sessionId?: string;
  onChange?(next: ClientViewData): void;
  /** Opens the clarification panel for one open item (UX-02). */
  onClarify?(question: string): void;
}

function Section({
  id,
  title,
  children,
  className,
  copy,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  className?: string;
  /** Markdown for this section alone, built on click (CopyButton). */
  copy?: () => string;
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
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-blueprint-text font-display text-2xl font-bold sm:text-3xl">
          {title}
        </h2>
        {copy && <CopyButton text={copy} label={title} />}
      </div>
      {children}
    </motion.section>
  );
}

export function ClientView({
  view,
  readOnly,
  onChange,
  onClarify,
}: ClientViewProps): React.ReactElement {
  const update = (next: Partial<ClientViewData>): void => {
    if (onChange) onChange({ ...view, ...next });
  };

  const updateMilestone = (index: number, patch: Partial<Milestone>): void => {
    update({
      milestones: view.milestones.map((ms, i) =>
        i === index ? { ...ms, ...patch } : ms,
      ),
    });
  };

  // Markdown for one section, built when the reader asks for it. The
  // builders are the export's own, so a copied section reads like the file.
  const markdownFor = (id: string) => (): string => {
    const section = clientSections(view).find((s) => s.id === id);
    return section ? sectionToMarkdown(section) : "";
  };
  const candidatesMarkdown = (): string =>
    sectionToMarkdown({
      id: "candidates",
      title: "Candidate modules — please confirm",
      lines: moduleTableLines(candidates),
    });

  // A key per milestone that survives an edit to its own fields, so a
  // renamed phase does not remount the card (BUG-09's lesson, applied here).
  const milestoneKeys = useMemo(
    () => view.milestones.map((ms, i) => `${i}-${ms.phase}`),
    [view.milestones],
  );

  // LOW-confidence modules are offered for confirmation rather than stated
  // as fact (blueprint step 07).
  const confirmed = view.modules.filter((m) => moduleLevel(m.confidence) !== "LOW");
  const candidates = view.modules.filter((m) => moduleLevel(m.confidence) === "LOW");

  return (
    <div className="flex flex-col gap-12">
      <Section id="summary" title="Summary" copy={markdownFor("summary")}>
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

      <Section id="modules" title="Modules" copy={markdownFor("modules")}>
        {readOnly ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {confirmed.map((m) => (
              <ReadOnlyModuleCard key={moduleId(m)} module={m} />
            ))}
          </div>
        ) : (
          <Reorder.Group
            axis="y"
            values={view.modules}
            onReorder={(modules: ClientModule[]) => update({ modules })}
            className="grid grid-cols-1 gap-4 md:grid-cols-2"
          >
            {confirmed.map((m) => (
              <ModuleCard
                key={moduleId(m)}
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

      {candidates.length > 0 && (
        <Section
          id="candidates"
          title="Candidate modules — please confirm"
          copy={candidatesMarkdown}
        >
          <p className="text-blueprint-muted mb-4 max-w-2xl text-sm">
            Aureon is less sure about these: little in your brief pointed at them, and
            similar projects did not back them up. Keep the ones you want.
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {candidates.map((m) =>
              readOnly ? (
                <ReadOnlyModuleCard key={moduleId(m)} module={m} />
              ) : (
                <ModuleCard
                  key={moduleId(m)}
                  module={m}
                  draggable={false}
                  onChange={(next) => {
                    const updated = view.modules.map((x) => (x === m ? next : x));
                    update({ modules: updated });
                  }}
                />
              ),
            )}
          </div>
        </Section>
      )}

      <Section id="milestones" title="Milestones" copy={markdownFor("milestones")}>
        <div className="-mx-6 overflow-x-auto px-6 pb-2">
          <ol className="flex min-w-max items-stretch gap-4">
            {view.milestones.map((ms: Milestone, i) => (
              <li
                key={milestoneKeys[i] ?? `${ms.phase}-${i}`}
                className="border-blueprint-line/20 flex w-72 shrink-0 flex-col gap-3 rounded-xl border bg-white/[0.025] p-5 backdrop-blur-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <SectionEditor
                    ariaLabel={`Milestone phase ${i + 1}`}
                    value={ms.phase}
                    disabled={readOnly}
                    maxLength={40}
                    onConfirm={(phase) => updateMilestone(i, { phase })}
                    className="text-blueprint-accent font-mono text-[10px] tracking-[0.18em] uppercase"
                  />
                  {!readOnly && (
                    <button
                      type="button"
                      aria-label={`Delete milestone ${ms.name}`}
                      onClick={() =>
                        update({ milestones: view.milestones.filter((_, j) => j !== i) })
                      }
                      className="text-blueprint-muted rounded-md p-1 hover:text-red-300"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                <SectionEditor
                  ariaLabel={`Milestone name ${i + 1}`}
                  value={ms.name}
                  disabled={readOnly}
                  maxLength={120}
                  onConfirm={(name) => updateMilestone(i, { name })}
                  className="text-blueprint-text font-display text-lg font-semibold"
                />
                <EditableList
                  items={ms.deliverables}
                  readOnly={readOnly}
                  reorderable
                  maxItems={12}
                  maxLength={200}
                  itemNoun="deliverable"
                  addLabel="Add deliverable"
                  empty="No deliverables listed."
                  onChange={(deliverables) => updateMilestone(i, { deliverables })}
                  rowClassName="text-blueprint-muted text-sm"
                />
              </li>
            ))}
            {!readOnly && view.milestones.length < 8 && (
              <li className="flex w-72 shrink-0 items-center justify-center">
                <button
                  type="button"
                  onClick={() =>
                    update({
                      milestones: [
                        ...view.milestones,
                        {
                          phase: `Phase ${view.milestones.length + 1}`,
                          name: "New milestone",
                          deliverables: ["First deliverable"],
                        },
                      ],
                    })
                  }
                  className="text-blueprint-muted border-blueprint-line/30 hover:text-blueprint-text inline-flex items-center gap-1.5 rounded-xl border border-dashed px-4 py-3 text-xs"
                >
                  <Plus size={13} />
                  Add milestone
                </button>
              </li>
            )}
          </ol>
        </div>
      </Section>

      {readOnly ? (
        <CollapsibleSection
          id="assumptions"
          title="What we assumed"
          items={view.assumptions}
          empty="No assumptions — every parameter was explicitly stated."
          copy={markdownFor("assumptions")}
        />
      ) : (
        <Section
          id="assumptions"
          title="What we assumed"
          copy={markdownFor("assumptions")}
        >
          <EditableList
            items={view.assumptions}
            onChange={(assumptions) => update({ assumptions })}
            itemNoun="assumption"
            addLabel="Add assumption"
            multiline
            empty="No assumptions — every parameter was explicitly stated."
          />
        </Section>
      )}

      <Section id="open-items" title="Open items" copy={markdownFor("open-items")}>
        {readOnly ? (
          view.open_items.length === 0 ? (
            <p className="text-blueprint-muted text-sm">Nothing outstanding.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {view.open_items.map((question, i) => (
                <li
                  key={`${question}-${i}`}
                  className="border-blueprint-line/20 flex items-start justify-between gap-3 rounded-lg border bg-white/[0.02] p-4 backdrop-blur-md"
                >
                  <span className="text-blueprint-text/95 text-sm">{question}</span>
                  {onClarify && (
                    <button
                      type="button"
                      onClick={() => onClarify(question)}
                      className="text-blueprint-accent inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-blueprint-accent)]/30 px-2.5 py-1 text-xs hover:bg-[var(--color-blueprint-accent)]/15"
                    >
                      <MessageSquare size={12} />
                      Clarify
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : (
          <EditableList
            items={view.open_items}
            onChange={(open_items) => update({ open_items })}
            itemNoun="open item"
            addLabel="Add open item"
            multiline
            empty="Nothing outstanding."
          />
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
  copy,
}: {
  id: string;
  title: string;
  items: string[];
  empty: string;
  copy?: () => string;
}): React.ReactElement {
  const [open, setOpen] = useState(items.length <= 6);
  return (
    <Section id={id} title={title} copy={copy}>
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
        <div className="flex shrink-0 items-center gap-2">
          <ModuleConfidenceChip confidence={module.confidence} />
          <span className="border-blueprint-line/30 text-blueprint-muted rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.18em] uppercase">
            {module.size.toLowerCase()}
          </span>
        </div>
      </div>
      <p className="text-blueprint-muted text-sm leading-relaxed">{module.description}</p>
      <SeenInRepos seenIn={module.seen_in} validated={module.github_validated} />
    </div>
  );
}
