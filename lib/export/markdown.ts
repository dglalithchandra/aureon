import type { ClientView, EngineerView, FinalOutput } from "@/lib/schemas/output";

/**
 * Markdown export. Treats every input string as untrusted: escapes pipes for
 * tables, escapes the markdown specials in inline contexts, and never emits
 * raw HTML. The result is safe to render with `react-markdown` configured to
 * disallow HTML and unknown tags.
 */

/** Escape characters that have meaning in inline Markdown. */
function esc(input: string): string {
  return input
    .replace(/\\/g, "\\\\")
    .replace(/([*_`~[\](){}#+!|<>])/g, "\\$1")
    .replace(/\r?\n/g, " ");
}

/** Escape pipe + backslash for table cells. */
function tcell(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function fence(lang: string, content: string): string {
  return ["```" + lang, content, "```"].join("\n");
}

/* ──────────────────────────────────────────────────────────────
 *  Client view
 * ────────────────────────────────────────────────────────────── */

/**
 * One part of a document, named by the same id the page gives its section,
 * so "copy this section" and the export can never drift apart.
 */
export interface MarkdownSection {
  id: string;
  title: string;
  lines: string[];
}

export function moduleTableLines(modules: ClientView["modules"]): string[] {
  const out = [
    "| # | Module | Size | Validated | Description |",
    "|---|--------|------|-----------|-------------|",
  ];
  modules.forEach((m, i) => {
    out.push(
      `| ${i + 1} | ${tcell(m.name)} | ${m.size} | ${m.github_validated ? "✓" : "—"} | ${tcell(m.description)} |`,
    );
  });
  return out;
}

export function clientSections(view: ClientView): MarkdownSection[] {
  const sections: MarkdownSection[] = [
    {
      id: "summary",
      title: "Summary",
      lines: [esc(view.project_summary)],
    },
    { id: "modules", title: "Modules", lines: moduleTableLines(view.modules) },
    {
      id: "milestones",
      title: "Milestones",
      lines: view.milestones.flatMap((ms) => [
        `### ${esc(ms.phase)} — ${esc(ms.name)}`,
        ...ms.deliverables.map((d) => `- ${esc(d)}`),
        "",
      ]),
    },
  ];

  if (view.assumptions.length > 0) {
    sections.push({
      id: "assumptions",
      title: "What we assumed",
      lines: view.assumptions.map((a) => `- ${esc(a)}`),
    });
  }
  if (view.open_items.length > 0) {
    sections.push({
      id: "open-items",
      title: "Open items",
      lines: view.open_items.map((q) => `- ${esc(q)}`),
    });
  }
  return sections;
}

/** The heading block every client document starts with. */
function clientPreamble(view: ClientView): string[] {
  return [
    "# Project Scope — Client View",
    "",
    `**Confidence:** ${view.confidence_badge.score}/100 ` +
      `(coverage ${view.confidence_badge.breakdown.coverage}, ` +
      `AI clarity read ${view.confidence_badge.breakdown.ai_clarity}, ` +
      `consistency ${view.confidence_badge.breakdown.consistency}, ` +
      `GitHub bonus +${view.confidence_badge.breakdown.github_bonus}, ` +
      `cap ${view.confidence_badge.breakdown.cap_applied})`,
    "",
  ];
}

function withoutTrailingBlanks(lines: readonly string[]): string[] {
  const out = [...lines];
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

/** One section as it appears in the document, heading included. */
export function sectionToMarkdown(section: MarkdownSection): string {
  return [`## ${section.title}`, "", ...withoutTrailingBlanks(section.lines)]
    .join("\n")
    .trimEnd();
}

function compose(preamble: string[], sections: MarkdownSection[]): string {
  const out = [...preamble];
  for (const section of sections) {
    out.push(`## ${section.title}`, "", ...withoutTrailingBlanks(section.lines), "");
  }
  return out.join("\n").trimEnd() + "\n";
}

export function clientToMarkdown(view: ClientView): string {
  return compose(clientPreamble(view), clientSections(view));
}

/* ──────────────────────────────────────────────────────────────
 *  Engineer view
 * ────────────────────────────────────────────────────────────── */

export function engineerSections(view: EngineerView): MarkdownSection[] {
  const sections: MarkdownSection[] = [];

  sections.push({
    id: "modules",
    title: "Modules",
    lines: [
      "| Module | Size | Stack | Dependencies | Notes |",
      "|--------|------|-------|--------------|-------|",
      ...view.module_table.map(
        (m) =>
          `| ${tcell(m.name)} | ${m.size} | ${tcell(m.tech_stack.join(", "))} | ${tcell(m.dependencies.join(", ") || "—")} | ${tcell(m.notes)} |`,
      ),
      "",
      "### API surface (per module)",
      "",
      ...view.module_table
        .filter((m) => m.api_endpoints.length > 0)
        .flatMap((m) => [
          `**${esc(m.name)}**`,
          "",
          fence("http", m.api_endpoints.join("\n")),
          "",
        ]),
    ],
  });

  sections.push({
    id: "build-order",
    title: "Build order",
    lines: view.build_order.map((name, i) => `${i + 1}. ${esc(name)}`),
  });

  if (view.database_sketch.length > 0) {
    sections.push({
      id: "database",
      title: "Database sketch",
      lines: view.database_sketch.flatMap((t) => [
        `### \`${esc(t.table)}\``,
        "",
        fence("sql", t.fields.join("\n")),
        ...(t.relations.length > 0
          ? ["", "Relations:", ...t.relations.map((r) => `- ${esc(r)}`)]
          : []),
        "",
      ]),
    });
  }

  sections.push({
    id: "auth",
    title: "Auth & RBAC",
    lines: [
      `Roles: ${view.auth_model.roles.map(esc).join(", ")}`,
      "",
      "| Role | Permissions |",
      "|------|-------------|",
      ...view.auth_model.roles.map(
        (role) =>
          `| ${tcell(role)} | ${tcell((view.auth_model.permissions_matrix[role] ?? []).join(", ") || "—")} |`,
      ),
    ],
  });

  if (view.third_party_checklist.length > 0) {
    sections.push({
      id: "third-party",
      title: "Third-party checklist",
      lines: view.third_party_checklist.map((item) => `- [ ] ${esc(item)}`),
    });
  }

  sections.push({
    id: "sprints",
    title: "Sprint breakdown",
    lines: [
      "| Sprint | Focus | Points | Modules |",
      "|--------|-------|--------|---------|",
      ...view.sprint_breakdown.map(
        (s) =>
          `| ${tcell(s.sprint)} | ${tcell(s.focus)} | ${s.story_points} | ${tcell(s.modules.join(", "))} |`,
      ),
    ],
  });

  if (view.testing_strategy.length > 0) {
    sections.push({
      id: "testing",
      title: "Testing strategy",
      lines: [
        "| Module | Unit | Integration | E2E |",
        "|--------|------|-------------|-----|",
        ...view.testing_strategy.map(
          (t) =>
            `| ${tcell(t.module)} | ${tcell(t.unit)} | ${tcell(t.integration)} | ${tcell(t.e2e)} |`,
        ),
      ],
    });
  }

  const securityKeys = Object.keys(view.security_per_module);
  if (securityKeys.length > 0) {
    sections.push({
      id: "security",
      title: "Security per module",
      lines: securityKeys.flatMap((mod) => [
        `### ${esc(mod)}`,
        ...(view.security_per_module[mod] ?? []).map((concern) => `- ${esc(concern)}`),
        "",
      ]),
    });
  }

  if (view.risks.length > 0) {
    sections.push({
      id: "risks",
      title: "Risks",
      lines: view.risks.map((r) => `- **${r.severity}** — ${esc(r.description)}`),
    });
  }

  sections.push({
    id: "github",
    title: "GitHub references",
    lines:
      view.github_references.length === 0
        ? ["No similar public projects found."]
        : view.github_references.map(
            (r) => `- [${esc(r.repo)}](${sanitizeUrl(r.url)}) — ${esc(r.why_relevant)}`,
          ),
  });

  return sections;
}

/**
 * The estimate, as the document states it (step 10). Exported so the page's
 * own effort section can be copied on its own.
 */
export function engineerEstimateLines(view: EngineerView): string[] {
  const effort = view.effort_summary;
  const out = [
    `**Estimate:** ${effort.total_sprints} sprints, ` +
      `team of ${effort.team_size}${effort.team_size_stated ? "" : " (assumed)"} ` +
      `(${esc(effort.confidence_band)})`,
  ];
  if (effort.total_points > 0) {
    // How it was calculated, so the number survives leaving the app.
    out.push(
      "",
      `**How we estimated this:** ${effort.total_points} story points ` +
        `(module sizes x${effort.domain_multiplier} for the domain) at ` +
        `${effort.velocity} points per 2-week sprint.`,
    );
  }
  return out;
}

/** The heading block every engineer document starts with. */
function engineerPreamble(view: EngineerView): string[] {
  return ["# Engineering Build Document", "", ...engineerEstimateLines(view), ""];
}

export function engineerToMarkdown(view: EngineerView): string {
  return compose(engineerPreamble(view), engineerSections(view));
}

/* ──────────────────────────────────────────────────────────────
 *  Combined
 * ────────────────────────────────────────────────────────────── */

export function finalOutputToMarkdown(output: FinalOutput): string {
  return [clientToMarkdown(output.client), engineerToMarkdown(output.engineer)].join(
    "\n\n---\n\n",
  );
}

/**
 * Allow only http(s) URLs in markdown link destinations. Everything else
 * (javascript:, data:, vbscript:, filesystem:) becomes an anchor stub —
 * defense-in-depth on top of react-markdown's sanitize layer.
 */
function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "#";
    return u.toString();
  } catch {
    return "#";
  }
}
