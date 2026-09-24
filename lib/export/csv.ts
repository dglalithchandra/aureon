import type { EngineerModuleRow, FinalOutput } from "@/lib/schemas/output";
import type { ModuleSize } from "@/lib/schemas/extraction";
import { pointsFor } from "@/lib/scoring/effort";

/**
 * The scope as issues, in the two CSV shapes people actually import.
 *
 * One row per module and one per sprint, with labels and an estimate, so a
 * scope can become a backlog without retyping it.
 *
 * Jira Cloud: "Prepare a CSV file for import"
 *   https://support.atlassian.com/jira-software-cloud/docs/prepare-a-csv-file-for-import/
 *   - The importer reads the header row and maps each column to a field.
 *     "Summary" is the only required column.
 *   - A field that takes several values (Labels, Component) is expressed by
 *     repeating the column name once per value, which is why the header
 *     below can carry several "Labels" columns.
 *   - Headers carry no punctuation beyond the separating commas: Atlassian
 *     warns that punctuation there makes the mapping unreliable.
 *   - "Work type" is the current Cloud name for what older Jira calls
 *     "Issue Type"; either maps to the same field in the import wizard.
 *
 * Linear: the CSV importer in @linear/import
 *   https://github.com/linear/linear/tree/master/packages/import
 *   https://linear.app/docs/import-issues
 *   - Columns: Title (required), Description, Priority, Status, Assignee,
 *     Labels, Estimate, Created, Completed. Names are case-sensitive.
 *   - Labels are one field holding a comma-separated list.
 *   - Priority is Linear's integer scale: 0 none, 1 urgent, 2 high,
 *     3 medium, 4 low. Estimate is an integer.
 */

/** One row of the backlog, before either tool's column names are applied. */
export interface ScopeIssue {
  kind: "module" | "sprint";
  title: string;
  description: string;
  labels: string[];
  /** Story points: a module's size, or a sprint's computed total. */
  estimate: number;
  size: ModuleSize | null;
}

const JIRA_PRIORITY: Record<ModuleSize, string> = {
  LARGE: "High",
  MEDIUM: "Medium",
  SMALL: "Low",
};

/** Linear's integer scale, not a name. */
const LINEAR_PRIORITY: Record<ModuleSize, number> = {
  LARGE: 2,
  MEDIUM: 3,
  SMALL: 4,
};

function moduleDescription(
  row: EngineerModuleRow,
  clientDescription: string | undefined,
): string {
  const parts: string[] = [];
  if (clientDescription) parts.push(clientDescription);
  if (row.notes) parts.push(row.notes);
  parts.push(`Stack: ${row.tech_stack.join(", ")}`);
  if (row.dependencies.length > 0) {
    parts.push(`Depends on: ${row.dependencies.join(", ")}`);
  }
  if (row.api_endpoints.length > 0) {
    parts.push(`Endpoints:\n${row.api_endpoints.join("\n")}`);
  }
  return parts.join("\n\n");
}

/**
 * The rows both formats are built from. Modules first, in the order the
 * document lists them, then the sprints in plan order.
 */
export function scopeIssues(output: FinalOutput): ScopeIssue[] {
  const describedBy = new Map(
    output.client.modules.map((m) => [m.name.toLowerCase(), m.description]),
  );

  const modules: ScopeIssue[] = output.engineer.module_table.map((row) => ({
    kind: "module",
    title: row.name,
    description: moduleDescription(row, describedBy.get(row.name.toLowerCase())),
    labels: ["aureon", "module", `size-${row.size.toLowerCase()}`],
    estimate: pointsFor(row.size),
    size: row.size,
  }));

  const sprints: ScopeIssue[] = output.engineer.sprint_breakdown.map((sprint) => ({
    kind: "sprint",
    title: `${sprint.sprint}: ${sprint.focus}`,
    description:
      sprint.modules.length > 0
        ? `Modules in this sprint: ${sprint.modules.join(", ")}`
        : "Carry-over work.",
    labels: ["aureon", "sprint"],
    estimate: sprint.story_points,
    size: null,
  }));

  return [...modules, ...sprints];
}

/* ──────────────────────────────────────────────────────────────
 *  CSV writing (RFC 4180)
 * ────────────────────────────────────────────────────────────── */

/**
 * Quote a field when it holds a comma, a quote, or a newline; double any
 * quote inside it. Rows end with CRLF, as RFC 4180 specifies and as both
 * importers expect.
 */
export function csvField(value: string | number): string {
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function csvRows(rows: ReadonlyArray<ReadonlyArray<string | number>>): string {
  return rows.map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
}

/* ──────────────────────────────────────────────────────────────
 *  Jira
 * ────────────────────────────────────────────────────────────── */

export const JIRA_BASE_COLUMNS = [
  "Work type",
  "Summary",
  "Description",
  "Story point estimate",
  "Priority",
] as const;

export function toJiraCsv(output: FinalOutput): string {
  const issues = scopeIssues(output);
  // One "Labels" column per value, per Atlassian's multi-value rule.
  const labelColumns = Math.max(0, ...issues.map((issue) => issue.labels.length));
  const header = [...JIRA_BASE_COLUMNS, ...Array(labelColumns).fill("Labels")];

  const rows: Array<Array<string | number>> = issues.map((issue) => {
    const labels = Array.from({ length: labelColumns }, (_, i) => issue.labels[i] ?? "");
    return [
      issue.kind === "module" ? "Story" : "Task",
      issue.title,
      issue.description,
      issue.estimate,
      issue.size ? JIRA_PRIORITY[issue.size] : "Medium",
      ...labels,
    ];
  });

  return csvRows([header, ...rows]);
}

/* ──────────────────────────────────────────────────────────────
 *  Linear
 * ────────────────────────────────────────────────────────────── */

export const LINEAR_COLUMNS = [
  "Title",
  "Description",
  "Status",
  "Priority",
  "Estimate",
  "Labels",
] as const;

export function toLinearCsv(output: FinalOutput): string {
  const rows: Array<Array<string | number>> = scopeIssues(output).map((issue) => [
    issue.title,
    issue.description,
    // Every imported issue starts in the backlog; Linear matches the name
    // of a workflow state, case-insensitively.
    "Backlog",
    issue.size ? LINEAR_PRIORITY[issue.size] : 3,
    issue.estimate,
    issue.labels.join(","),
  ]);

  return csvRows([[...LINEAR_COLUMNS], ...rows]);
}
