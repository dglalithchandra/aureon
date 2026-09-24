"use client";
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowDown,
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronDown,
  ExternalLink,
  Plus,
  Shield,
  Trash2,
} from "lucide-react";
import {
  moduleId,
  newModuleId,
  type EngineerView as EngineerViewData,
  type EngineerModuleRow,
  type RiskSeverity,
  type Sprint,
} from "@/lib/schemas/output";
import { ModuleConfidenceChip } from "@/components/output/ModuleConfidence";
import { SectionEditor } from "@/components/output/SectionEditor";
import { EditableList } from "@/components/output/EditableList";
import { CopyButton } from "@/components/output/CopyButton";
import {
  engineerEstimateLines,
  engineerSections,
  sectionToMarkdown,
} from "@/lib/export/markdown";
import {
  EffortSummaryPanel,
  recomputeEstimate,
  type RecomputedEstimate,
} from "@/components/output/EffortSummary";
import { cn } from "@/lib/utils";

interface EngineerViewProps {
  view: EngineerViewData;
  readOnly?: boolean;
  /** Present when the reader owns the scope and may correct it (UX-02). */
  onChange?(next: EngineerViewData): void;
  /**
   * Local persistence for the third-party checklist. The server stores the
   * EngineerView verbatim — we don't add a new field — so this is browser-
   * local only, scoped per session id.
   */
  checklistKey?: string;
}

const SIZE_RANK: Record<EngineerModuleRow["size"], number> = {
  SMALL: 1,
  MEDIUM: 2,
  LARGE: 3,
};

const RISK_TONE: Record<RiskSeverity, string> = {
  CRITICAL: "border-red-500/40 bg-red-500/10 text-red-300",
  WARNING: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  NOTE: "border-blueprint-line/30 bg-blueprint-line/5 text-blueprint-muted",
};

function Section({
  id,
  title,
  children,
  copy,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
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
      className="scroll-mt-28"
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

export function EngineerView({
  view,
  readOnly,
  onChange,
  checklistKey,
}: EngineerViewProps): React.ReactElement {
  const editable = !readOnly && onChange !== undefined;
  const update = (next: Partial<EngineerViewData>): void => {
    if (onChange) onChange({ ...view, ...next });
  };
  const updateModule = (id: string, patch: Partial<EngineerModuleRow>): void => {
    update({
      module_table: view.module_table.map((row) =>
        moduleId(row) === id ? { ...row, ...patch } : row,
      ),
    });
  };
  const updateSprint = (index: number, patch: Partial<Sprint>): void => {
    update({
      sprint_breakdown: view.sprint_breakdown.map((sprint, i) =>
        i === index ? { ...sprint, ...patch } : sprint,
      ),
    });
  };

  // Markdown for one section, built when the reader asks for it, from the
  // export's own builders.
  const markdownFor = (id: string) => (): string => {
    const section = engineerSections(view).find((s) => s.id === id);
    return section ? sectionToMarkdown(section) : "";
  };

  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [openSecurity, setOpenSecurity] = useState<string | null>(null);
  // Blueprint step 10: the reader can try a different team size and the
  // estimate follows, because the numbers are computed, not written.
  const [teamSize, setTeamSize] = useState(view.effort_summary.team_size);
  const estimate = useMemo(
    () => recomputeEstimate(view.effort_summary, teamSize),
    [view.effort_summary, teamSize],
  );
  const sprintRows = useMemo(
    () => mergeFocus(estimate, view.sprint_breakdown),
    [estimate, view.sprint_breakdown],
  );

  const sortedModules = useMemo(() => {
    return [...view.module_table].sort((a, b) => {
      const da = SIZE_RANK[a.size] - SIZE_RANK[b.size];
      return sortDir === "asc" ? da : -da;
    });
  }, [view.module_table, sortDir]);

  return (
    <div className="flex flex-col gap-12">
      <Section
        id="effort"
        title="Effort summary"
        copy={() =>
          sectionToMarkdown({
            id: "effort",
            title: "Effort summary",
            lines: engineerEstimateLines(view),
          })
        }
      >
        <EffortSummaryPanel
          summary={view.effort_summary}
          estimate={estimate}
          teamSize={teamSize}
          onTeamSize={setTeamSize}
        />
      </Section>

      <Section id="modules" title="Modules" copy={markdownFor("modules")}>
        <div className="border-blueprint-line/15 overflow-x-auto rounded-xl border bg-white/[0.02] backdrop-blur-md">
          <table className="w-full text-left text-sm">
            <thead className="text-blueprint-muted bg-blueprint-line/5 sticky top-0 font-mono text-[10px] tracking-[0.18em] uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Module</th>
                <th className="px-4 py-3 font-medium">
                  <button
                    type="button"
                    onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                    className="hover:text-blueprint-text inline-flex items-center gap-1"
                  >
                    Size
                    {sortDir === "asc" ? (
                      <ArrowUpAZ size={11} />
                    ) : (
                      <ArrowDownAZ size={11} />
                    )}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium">Confidence</th>
                <th className="px-4 py-3 font-medium">Stack</th>
                <th className="px-4 py-3 font-medium">Dependencies</th>
                <th className="px-4 py-3 font-medium">Notes</th>
                {editable && <th className="sr-only px-4 py-3 font-medium">Remove</th>}
              </tr>
            </thead>
            <tbody>
              {sortedModules.map((m) => {
                const id = moduleId(m);
                return (
                  <tr key={id} className="border-blueprint-line/10 border-t align-top">
                    <td className="text-blueprint-text px-4 py-3 font-medium">
                      <SectionEditor
                        value={m.name}
                        disabled={!editable}
                        maxLength={80}
                        ariaLabel={`Module name, ${m.name}`}
                        onConfirm={(name) => updateModule(id, { name })}
                      />
                    </td>
                    <td className="px-4 py-3 capitalize">
                      {editable ? (
                        <select
                          aria-label={`Size of ${m.name}`}
                          value={m.size}
                          onChange={(e) =>
                            updateModule(id, {
                              size: e.target.value as EngineerModuleRow["size"],
                            })
                          }
                          className="border-blueprint-line/30 text-blueprint-text rounded-md border bg-white/[0.03] px-2 py-1 text-xs capitalize"
                        >
                          {(["SMALL", "MEDIUM", "LARGE"] as const).map((size) => (
                            <option key={size} value={size} className="bg-blueprint-bg">
                              {size.toLowerCase()}
                            </option>
                          ))}
                        </select>
                      ) : (
                        m.size.toLowerCase()
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ModuleConfidenceChip confidence={m.confidence} />
                    </td>
                    <td className="text-blueprint-muted px-4 py-3 font-mono text-xs">
                      {editable ? (
                        <EditableList
                          items={m.tech_stack}
                          onChange={(tech_stack) => updateModule(id, { tech_stack })}
                          addLabel="Add tech"
                          itemNoun={`tech for ${m.name}`}
                          maxLength={60}
                          maxItems={12}
                          className="min-w-44"
                        />
                      ) : (
                        m.tech_stack.join(", ")
                      )}
                    </td>
                    <td className="text-blueprint-muted px-4 py-3 text-xs">
                      {editable ? (
                        <EditableList
                          items={m.dependencies}
                          onChange={(dependencies) => updateModule(id, { dependencies })}
                          addLabel="Add dependency"
                          itemNoun={`dependency of ${m.name}`}
                          maxLength={80}
                          maxItems={20}
                          className="min-w-44"
                          empty="None"
                        />
                      ) : m.dependencies.length > 0 ? (
                        m.dependencies.join(", ")
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="text-blueprint-muted px-4 py-3 text-xs">
                      <SectionEditor
                        value={m.notes}
                        disabled={!editable}
                        multiline
                        allowEmpty
                        maxLength={400}
                        ariaLabel={`Notes on ${m.name}`}
                        onConfirm={(notes) => updateModule(id, { notes })}
                      />
                    </td>
                    {editable && (
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          aria-label={`Delete module ${m.name}`}
                          disabled={view.module_table.length <= 1}
                          onClick={() =>
                            update({
                              module_table: view.module_table.filter(
                                (row) => moduleId(row) !== id,
                              ),
                            })
                          }
                          className="text-blueprint-muted rounded-md p-1 hover:text-red-300 disabled:opacity-30"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {editable && view.module_table.length < 40 && (
          <button
            type="button"
            onClick={() =>
              update({
                module_table: [
                  ...view.module_table,
                  {
                    id: newModuleId(),
                    name: "New module",
                    confidence: null,
                    tech_stack: ["To decide"],
                    size: "MEDIUM",
                    dependencies: [],
                    api_endpoints: [],
                    notes: "",
                  },
                ],
              })
            }
            className="text-blueprint-muted border-blueprint-line/30 hover:text-blueprint-text mt-3 inline-flex w-fit items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-xs"
          >
            <Plus size={12} />
            Add module row
          </button>
        )}

        <div className="mt-6 flex flex-col gap-4">
          {view.module_table
            // Read-only, only the modules that have endpoints are worth a card;
            // editing needs one per module, so endpoints can be added.
            .filter((m) => editable || m.api_endpoints.length > 0)
            .map((m) => (
              <div
                key={`${moduleId(m)}-api`}
                className="border-blueprint-line/15 rounded-lg border bg-white/[0.02] p-4"
              >
                <h4 className="text-blueprint-text mb-2 font-mono text-xs tracking-wide">
                  {m.name}
                </h4>
                {editable ? (
                  <EditableList
                    items={m.api_endpoints}
                    onChange={(api_endpoints) =>
                      updateModule(moduleId(m), { api_endpoints })
                    }
                    addLabel="Add endpoint"
                    itemNoun={`endpoint of ${m.name}`}
                    maxLength={160}
                    maxItems={40}
                    rowClassName="font-mono text-xs"
                    empty="No endpoints yet."
                  />
                ) : (
                  <pre className="text-blueprint-muted overflow-x-auto font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
                    {m.api_endpoints.join("\n")}
                  </pre>
                )}
              </div>
            ))}
        </div>
      </Section>

      <Section id="build-order" title="Build order" copy={markdownFor("build-order")}>
        {editable ? (
          // Order is the whole point of this list, so it is the one that drags.
          <EditableList
            items={view.build_order}
            onChange={(build_order) => update({ build_order })}
            addLabel="Add step"
            itemNoun="build step"
            maxLength={80}
            maxItems={40}
            reorderable
            className="border-blueprint-line/15 rounded-xl border bg-white/[0.02] p-3 backdrop-blur-md"
          />
        ) : (
          <ol className="border-blueprint-line/15 flex flex-col rounded-xl border bg-white/[0.02] p-2 backdrop-blur-md">
            {view.build_order.map((name, i) => (
              <li
                key={`${name}-${i}`}
                className="text-blueprint-text flex items-center gap-3 px-3 py-2"
              >
                <span className="text-blueprint-muted w-6 shrink-0 font-mono text-xs">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-medium">{name}</span>
                {i < view.build_order.length - 1 && (
                  <ArrowDown className="text-blueprint-line/40 ml-auto" size={12} />
                )}
              </li>
            ))}
          </ol>
        )}
      </Section>

      {view.database_sketch.length > 0 && (
        <Section id="database" title="Database sketch" copy={markdownFor("database")}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {view.database_sketch.map((t, i) => (
              <div
                key={`${t.table}-${i}`}
                className="border-blueprint-line/15 rounded-xl border bg-white/[0.02] p-5"
              >
                <h4 className="text-blueprint-text mb-3 font-mono text-sm">{t.table}</h4>
                <pre className="text-blueprint-muted overflow-x-auto font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
                  {t.fields.join("\n")}
                </pre>
                {t.relations.length > 0 && (
                  <ul className="border-blueprint-line/15 text-blueprint-muted mt-3 flex flex-col gap-1 border-t pt-3 text-xs">
                    {t.relations.map((r, j) => (
                      <li key={j} className="font-mono">
                        {r}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section id="auth" title="Auth & RBAC" copy={markdownFor("auth")}>
        <div className="border-blueprint-line/15 overflow-x-auto rounded-xl border bg-white/[0.02]">
          <table className="w-full text-left text-sm">
            <thead className="text-blueprint-muted bg-blueprint-line/5 font-mono text-[10px] tracking-[0.18em] uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Permissions</th>
              </tr>
            </thead>
            <tbody>
              {view.auth_model.roles.map((role) => (
                <tr key={role} className="border-blueprint-line/10 border-t align-top">
                  <td className="text-blueprint-text px-4 py-3 font-medium">{role}</td>
                  <td className="text-blueprint-muted px-4 py-3 font-mono text-xs">
                    {(view.auth_model.permissions_matrix[role] ?? []).join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {view.third_party_checklist.length > 0 && (
        <Section
          id="third-party"
          title="Third-party checklist"
          copy={markdownFor("third-party")}
        >
          <PersistentChecklist
            items={view.third_party_checklist}
            storageKey={checklistKey ? `scopeai:checklist:${checklistKey}` : null}
          />
        </Section>
      )}

      <Section id="sprints" title="Sprint breakdown" copy={markdownFor("sprints")}>
        {editable ? (
          <>
            <ol className="flex flex-col gap-3">
              {view.sprint_breakdown.map((sprint, i) => (
                <li
                  key={`sprint-${i}`}
                  className="border-blueprint-line/15 flex flex-col gap-3 rounded-xl border bg-white/[0.02] p-4"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="w-32 shrink-0">
                      <SectionEditor
                        value={sprint.sprint}
                        maxLength={40}
                        ariaLabel={`Name of ${sprint.sprint}`}
                        onConfirm={(name) => updateSprint(i, { sprint: name })}
                        className="text-blueprint-accent font-mono text-xs tracking-[0.16em] uppercase"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <SectionEditor
                        value={sprint.focus}
                        maxLength={200}
                        ariaLabel={`Focus of ${sprint.sprint}`}
                        onConfirm={(focus) => updateSprint(i, { focus })}
                        className="text-blueprint-text font-medium"
                      />
                    </div>
                    <span className="text-blueprint-muted shrink-0 font-mono text-xs">
                      {sprint.story_points} pt{sprint.story_points === 1 ? "" : "s"}
                    </span>
                    <button
                      type="button"
                      aria-label={`Delete ${sprint.sprint}`}
                      disabled={view.sprint_breakdown.length <= 1}
                      onClick={() =>
                        update({
                          sprint_breakdown: view.sprint_breakdown.filter(
                            (_, j) => j !== i,
                          ),
                        })
                      }
                      className="text-blueprint-muted shrink-0 rounded-md p-1 hover:text-red-300 disabled:opacity-30"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <EditableList
                    items={sprint.modules}
                    onChange={(modules) => updateSprint(i, { modules })}
                    addLabel="Add module"
                    itemNoun={`module in ${sprint.sprint}`}
                    maxLength={80}
                    maxItems={20}
                    empty="No modules in this sprint."
                  />
                </li>
              ))}
            </ol>
            {view.sprint_breakdown.length < 20 && (
              <button
                type="button"
                onClick={() =>
                  update({
                    sprint_breakdown: [
                      ...view.sprint_breakdown,
                      {
                        sprint: `Sprint ${view.sprint_breakdown.length + 1}`,
                        focus: "To be decided",
                        story_points: 0,
                        modules: [],
                      },
                    ],
                  })
                }
                className="text-blueprint-muted border-blueprint-line/30 hover:text-blueprint-text mt-3 inline-flex w-fit items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-xs"
              >
                <Plus size={12} />
                Add sprint
              </button>
            )}
            <p className="text-blueprint-muted mt-3 text-xs leading-relaxed">
              Story points are computed from module sizes and the team size, so they are
              not editable here and the plan is re-cut the next time the scope is
              generated.
            </p>
          </>
        ) : (
          <ol className="flex flex-col gap-3">
            {sprintRows.map((s, i) => (
              <li
                key={`${s.sprint}-${i}`}
                className="border-blueprint-line/15 flex flex-col gap-2 rounded-xl border bg-white/[0.02] p-4 sm:flex-row sm:items-center sm:gap-6"
              >
                <span className="text-blueprint-accent w-24 shrink-0 font-mono text-xs tracking-[0.16em] uppercase">
                  {s.sprint}
                </span>
                <span className="text-blueprint-text flex-1 font-medium">{s.focus}</span>
                <span className="text-blueprint-muted shrink-0 font-mono text-xs">
                  {s.story_points} pt{s.story_points === 1 ? "" : "s"}
                </span>
                <span className="text-blueprint-muted shrink-0 text-xs">
                  {s.modules.join(", ")}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {view.testing_strategy.length > 0 && (
        <Section id="testing" title="Testing strategy" copy={markdownFor("testing")}>
          <div className="border-blueprint-line/15 overflow-x-auto rounded-xl border bg-white/[0.02]">
            <table className="w-full text-left text-sm">
              <thead className="text-blueprint-muted bg-blueprint-line/5 font-mono text-[10px] tracking-[0.18em] uppercase">
                <tr>
                  <th className="px-4 py-3 font-medium">Module</th>
                  <th className="px-4 py-3 font-medium">Unit</th>
                  <th className="px-4 py-3 font-medium">Integration</th>
                  <th className="px-4 py-3 font-medium">E2E</th>
                </tr>
              </thead>
              <tbody>
                {view.testing_strategy.map((t, i) => (
                  <tr
                    key={`${t.module}-${i}`}
                    className="border-blueprint-line/10 border-t align-top"
                  >
                    <td className="text-blueprint-text px-4 py-3 font-medium">
                      {t.module}
                    </td>
                    <td className="text-blueprint-muted px-4 py-3 text-xs">{t.unit}</td>
                    <td className="text-blueprint-muted px-4 py-3 text-xs">
                      {t.integration}
                    </td>
                    <td className="text-blueprint-muted px-4 py-3 text-xs">{t.e2e}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {Object.keys(view.security_per_module).length > 0 && (
        <Section id="security" title="Security per module" copy={markdownFor("security")}>
          <div className="border-blueprint-line/15 flex flex-col rounded-xl border bg-white/[0.02] backdrop-blur-md">
            {Object.entries(view.security_per_module).map(([mod, items], i) => (
              <div key={mod} className={cn(i > 0 && "border-blueprint-line/10 border-t")}>
                <button
                  type="button"
                  onClick={() => setOpenSecurity((cur) => (cur === mod ? null : mod))}
                  aria-expanded={openSecurity === mod}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <span className="inline-flex items-center gap-2">
                    <Shield size={14} className="text-[var(--color-blueprint-accent)]" />
                    <span className="text-blueprint-text font-medium">{mod}</span>
                    <span className="text-blueprint-muted text-xs">({items.length})</span>
                  </span>
                  <motion.span animate={{ rotate: openSecurity === mod ? 180 : 0 }}>
                    <ChevronDown size={16} className="text-blueprint-muted" />
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {openSecurity === mod && (
                    <motion.ul
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="border-blueprint-line/10 flex flex-col gap-1.5 border-t px-4 py-3 text-sm">
                        {items.map((it, j) => (
                          <li key={j} className="text-blueprint-muted">
                            • {it}
                          </li>
                        ))}
                      </div>
                    </motion.ul>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </Section>
      )}

      {view.risks.length > 0 && (
        <Section id="risks" title="Risks" copy={markdownFor("risks")}>
          <ul className="flex flex-col gap-2.5">
            {view.risks.map((r, i) => (
              <li
                key={i}
                className={cn(
                  "rounded-lg border px-4 py-3 text-sm",
                  RISK_TONE[r.severity],
                )}
              >
                <span className="mr-2 font-mono text-[10px] tracking-[0.18em] uppercase">
                  {r.severity}
                </span>
                <span>{r.description}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section id="github" title="GitHub references" copy={markdownFor("github")}>
        {view.github_references.length === 0 ? (
          <p className="text-blueprint-muted text-sm">
            No similar public projects found. Nothing here is invented: these come from
            the repositories this scope was matched against.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {view.github_references.map((r, i) => (
              <a
                key={`${r.repo}-${i}`}
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="border-blueprint-line/20 group flex items-start justify-between gap-3 rounded-xl border bg-white/[0.025] p-4 backdrop-blur-md transition-colors hover:border-[var(--color-blueprint-accent)]/40"
              >
                <div className="min-w-0">
                  <p className="text-blueprint-text font-mono text-sm font-semibold">
                    {r.repo}
                  </p>
                  <p className="text-blueprint-muted mt-1 text-xs leading-relaxed">
                    {r.why_relevant}
                  </p>
                </div>
                <ExternalLink
                  size={14}
                  className="text-blueprint-muted mt-1 shrink-0 group-hover:text-[var(--color-blueprint-accent)]"
                />
              </a>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/**
 * The sprint rows for the team size on screen. The plan itself is computed
 * (blueprint step 10); the model's focus line is kept only where that sprint
 * still covers the same modules, so a re-plan can never mislabel a sprint.
 */
function mergeFocus(
  estimate: RecomputedEstimate,
  written: EngineerViewData["sprint_breakdown"],
): EngineerViewData["sprint_breakdown"] {
  return estimate.plan.map((row, i) => {
    const original = written[i];
    const sameModules =
      original !== undefined &&
      original.modules.length === row.modules.length &&
      original.modules.every((m, j) => m === row.modules[j]);
    return {
      sprint: row.sprint,
      focus: sameModules
        ? original.focus
        : row.modules.length > 0
          ? row.modules.join(", ")
          : "Carry-over work",
      story_points: row.storyPoints,
      modules: row.modules,
    };
  });
}

interface PersistentChecklistProps {
  items: string[];
  storageKey: string | null;
}

function PersistentChecklist({
  items,
  storageKey,
}: PersistentChecklistProps): React.ReactElement {
  const [checked, setChecked] = useState<Set<string>>(() => {
    if (typeof window === "undefined" || !storageKey) return new Set();
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((x): x is string => typeof x === "string"));
      }
    } catch {
      /* ignore */
    }
    return new Set();
  });

  const toggle = (label: string): void => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      if (typeof window !== "undefined" && storageKey) {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(Array.from(next)));
        } catch {
          /* ignore quota errors */
        }
      }
      return next;
    });
  };

  return (
    <ul className="border-blueprint-line/15 flex flex-col rounded-xl border bg-white/[0.02] backdrop-blur-md">
      {items.map((it, i) => {
        const isChecked = checked.has(it);
        return (
          <li
            key={i}
            className={cn(
              "flex items-center gap-3 px-4 py-3",
              i > 0 && "border-blueprint-line/10 border-t",
            )}
          >
            <label className="flex w-full cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                className="sr-only"
                checked={isChecked}
                onChange={() => toggle(it)}
                aria-label={it}
              />
              <span
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                  isChecked
                    ? "border-[var(--color-blueprint-accent)] bg-[var(--color-blueprint-accent)] text-[var(--color-blueprint-bg)]"
                    : "border-blueprint-line/40",
                )}
                aria-hidden
              >
                {isChecked && (
                  <svg viewBox="0 0 14 14" className="h-3 w-3" aria-hidden>
                    <path
                      d="M2.5 7.5l3 3 6-6"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              <span
                className={cn(
                  "text-sm",
                  isChecked ? "text-blueprint-muted line-through" : "text-blueprint-text",
                )}
              >
                {it}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
