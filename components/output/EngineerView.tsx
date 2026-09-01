"use client";
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowDown,
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronDown,
  ExternalLink,
  Shield,
} from "lucide-react";
import type {
  EngineerView as EngineerViewData,
  EngineerModuleRow,
  RiskSeverity,
} from "@/lib/schemas/output";
import { cn } from "@/lib/utils";

interface EngineerViewProps {
  view: EngineerViewData;
  readOnly?: boolean;
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
}: {
  id: string;
  title: string;
  children: React.ReactNode;
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
      <h2 className="text-blueprint-text mb-5 font-display text-2xl font-bold sm:text-3xl">
        {title}
      </h2>
      {children}
    </motion.section>
  );
}

export function EngineerView({
  view,
  checklistKey,
}: EngineerViewProps): React.ReactElement {
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [openSecurity, setOpenSecurity] = useState<string | null>(null);

  const sortedModules = useMemo(() => {
    return [...view.module_table].sort((a, b) => {
      const da = SIZE_RANK[a.size] - SIZE_RANK[b.size];
      return sortDir === "asc" ? da : -da;
    });
  }, [view.module_table, sortDir]);

  return (
    <div className="flex flex-col gap-12">
      <Section id="effort" title="Effort summary">
        <div className="border-blueprint-line/20 inline-flex flex-col gap-3 rounded-2xl border bg-white/[0.025] px-6 py-5 backdrop-blur-md sm:flex-row sm:items-center sm:gap-8">
          <BigStat label="Sprints" value={view.effort_summary.total_sprints} />
          <Divider />
          <BigStat label="Team size" value={view.effort_summary.team_size} />
          <Divider />
          <div className="flex flex-col">
            <span className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase">
              Confidence band
            </span>
            <span className="text-blueprint-text font-display text-lg font-bold">
              {view.effort_summary.confidence_band}
            </span>
          </div>
        </div>
      </Section>

      <Section id="modules" title="Modules">
        <div className="border-blueprint-line/15 overflow-x-auto rounded-xl border bg-white/[0.02] backdrop-blur-md">
          <table className="w-full text-left text-sm">
            <thead className="text-blueprint-muted bg-blueprint-line/5 sticky top-0 font-mono text-[10px] tracking-[0.18em] uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Module</th>
                <th className="px-4 py-3 font-medium">
                  <button
                    type="button"
                    onClick={() =>
                      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
                    }
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
                <th className="px-4 py-3 font-medium">Stack</th>
                <th className="px-4 py-3 font-medium">Dependencies</th>
                <th className="px-4 py-3 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {sortedModules.map((m, i) => (
                <tr
                  key={`${m.name}-${i}`}
                  className="border-blueprint-line/10 border-t align-top"
                >
                  <td className="text-blueprint-text px-4 py-3 font-medium">
                    {m.name}
                  </td>
                  <td className="px-4 py-3 capitalize">{m.size.toLowerCase()}</td>
                  <td className="text-blueprint-muted px-4 py-3 font-mono text-xs">
                    {m.tech_stack.join(", ")}
                  </td>
                  <td className="text-blueprint-muted px-4 py-3 text-xs">
                    {m.dependencies.length > 0 ? m.dependencies.join(", ") : "—"}
                  </td>
                  <td className="text-blueprint-muted px-4 py-3 text-xs">
                    {m.notes || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex flex-col gap-4">
          {view.module_table
            .filter((m) => m.api_endpoints.length > 0)
            .map((m, i) => (
              <div
                key={`${m.name}-api-${i}`}
                className="border-blueprint-line/15 rounded-lg border bg-white/[0.02] p-4"
              >
                <h4 className="text-blueprint-text mb-2 font-mono text-xs tracking-wide">
                  {m.name}
                </h4>
                <pre className="text-blueprint-muted overflow-x-auto font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
                  {m.api_endpoints.join("\n")}
                </pre>
              </div>
            ))}
        </div>
      </Section>

      <Section id="build-order" title="Build order">
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
                <ArrowDown
                  className="text-blueprint-line/40 ml-auto"
                  size={12}
                />
              )}
            </li>
          ))}
        </ol>
      </Section>

      {view.database_sketch.length > 0 && (
        <Section id="database" title="Database sketch">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {view.database_sketch.map((t, i) => (
              <div
                key={`${t.table}-${i}`}
                className="border-blueprint-line/15 rounded-xl border bg-white/[0.02] p-5"
              >
                <h4 className="text-blueprint-text mb-3 font-mono text-sm">
                  {t.table}
                </h4>
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

      <Section id="auth" title="Auth & RBAC">
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
                <tr
                  key={role}
                  className="border-blueprint-line/10 border-t align-top"
                >
                  <td className="text-blueprint-text px-4 py-3 font-medium">
                    {role}
                  </td>
                  <td className="text-blueprint-muted px-4 py-3 font-mono text-xs">
                    {(view.auth_model.permissions_matrix[role] ?? []).join(", ") ||
                      "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {view.third_party_checklist.length > 0 && (
        <Section id="third-party" title="Third-party checklist">
          <PersistentChecklist
            items={view.third_party_checklist}
            storageKey={
              checklistKey ? `scopeai:checklist:${checklistKey}` : null
            }
          />
        </Section>
      )}

      <Section id="sprints" title="Sprint breakdown">
        <ol className="flex flex-col gap-3">
          {view.sprint_breakdown.map((s, i) => (
            <li
              key={`${s.sprint}-${i}`}
              className="border-blueprint-line/15 flex flex-col gap-2 rounded-xl border bg-white/[0.02] p-4 sm:flex-row sm:items-center sm:gap-6"
            >
              <span className="text-blueprint-accent w-24 shrink-0 font-mono text-xs tracking-[0.16em] uppercase">
                {s.sprint}
              </span>
              <span className="text-blueprint-text flex-1 font-medium">
                {s.focus}
              </span>
              <span className="text-blueprint-muted shrink-0 font-mono text-xs">
                {s.story_points} pts
              </span>
              <span className="text-blueprint-muted shrink-0 text-xs">
                {s.modules.join(", ")}
              </span>
            </li>
          ))}
        </ol>
      </Section>

      {view.testing_strategy.length > 0 && (
        <Section id="testing" title="Testing strategy">
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
                    <td className="text-blueprint-muted px-4 py-3 text-xs">
                      {t.unit}
                    </td>
                    <td className="text-blueprint-muted px-4 py-3 text-xs">
                      {t.integration}
                    </td>
                    <td className="text-blueprint-muted px-4 py-3 text-xs">
                      {t.e2e}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {Object.keys(view.security_per_module).length > 0 && (
        <Section id="security" title="Security per module">
          <div className="border-blueprint-line/15 flex flex-col rounded-xl border bg-white/[0.02] backdrop-blur-md">
            {Object.entries(view.security_per_module).map(([mod, items], i) => (
              <div
                key={mod}
                className={cn(
                  i > 0 && "border-blueprint-line/10 border-t",
                )}
              >
                <button
                  type="button"
                  onClick={() =>
                    setOpenSecurity((cur) => (cur === mod ? null : mod))
                  }
                  aria-expanded={openSecurity === mod}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <span className="inline-flex items-center gap-2">
                    <Shield
                      size={14}
                      className="text-[var(--color-blueprint-accent)]"
                    />
                    <span className="text-blueprint-text font-medium">
                      {mod}
                    </span>
                    <span className="text-blueprint-muted text-xs">
                      ({items.length})
                    </span>
                  </span>
                  <motion.span
                    animate={{ rotate: openSecurity === mod ? 180 : 0 }}
                  >
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
        <Section id="risks" title="Risks">
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

      {view.github_references.length > 0 && (
        <Section id="github" title="GitHub references">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {view.github_references.map((r, i) => (
              <a
                key={`${r.repo}-${i}`}
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="border-blueprint-line/20 hover:border-[var(--color-blueprint-accent)]/40 group flex items-start justify-between gap-3 rounded-xl border bg-white/[0.025] p-4 backdrop-blur-md transition-colors"
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
                  className="text-blueprint-muted group-hover:text-[var(--color-blueprint-accent)] mt-1 shrink-0"
                />
              </a>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function BigStat({
  label,
  value,
}: {
  label: string;
  value: number;
}): React.ReactElement {
  return (
    <div className="flex flex-col">
      <span className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase">
        {label}
      </span>
      <span className="text-blueprint-text font-display text-3xl font-bold tabular-nums">
        {value}
      </span>
    </div>
  );
}

function Divider(): React.ReactElement {
  return <span className="bg-blueprint-line/15 hidden h-10 w-px sm:block" />;
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
          window.localStorage.setItem(
            storageKey,
            JSON.stringify(Array.from(next)),
          );
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
                  isChecked
                    ? "text-blueprint-muted line-through"
                    : "text-blueprint-text",
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
