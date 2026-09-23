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

export function clientToMarkdown(view: ClientView): string {
  const out: string[] = [];
  out.push("# Project Scope — Client View");
  out.push("");
  out.push(
    `**Confidence:** ${view.confidence_badge.score}/100 ` +
      `(coverage ${view.confidence_badge.breakdown.coverage}, ` +
      `AI clarity read ${view.confidence_badge.breakdown.ai_clarity}, ` +
      `consistency ${view.confidence_badge.breakdown.consistency}, ` +
      `GitHub bonus +${view.confidence_badge.breakdown.github_bonus}, ` +
      `cap ${view.confidence_badge.breakdown.cap_applied})`,
  );
  out.push("");
  out.push("## Summary");
  out.push("");
  out.push(esc(view.project_summary));
  out.push("");

  out.push("## Modules");
  out.push("");
  out.push("| # | Module | Size | Validated | Description |");
  out.push("|---|--------|------|-----------|-------------|");
  view.modules.forEach((m, i) => {
    out.push(
      `| ${i + 1} | ${tcell(m.name)} | ${m.size} | ${m.github_validated ? "✓" : "—"} | ${tcell(m.description)} |`,
    );
  });
  out.push("");

  out.push("## Milestones");
  out.push("");
  for (const ms of view.milestones) {
    out.push(`### ${esc(ms.phase)} — ${esc(ms.name)}`);
    for (const d of ms.deliverables) out.push(`- ${esc(d)}`);
    out.push("");
  }

  if (view.assumptions.length > 0) {
    out.push("## What we assumed");
    out.push("");
    for (const a of view.assumptions) out.push(`- ${esc(a)}`);
    out.push("");
  }

  if (view.open_items.length > 0) {
    out.push("## Open items");
    out.push("");
    for (const q of view.open_items) out.push(`- ${esc(q)}`);
    out.push("");
  }

  return out.join("\n").trimEnd() + "\n";
}

/* ──────────────────────────────────────────────────────────────
 *  Engineer view
 * ────────────────────────────────────────────────────────────── */

export function engineerToMarkdown(view: EngineerView): string {
  const out: string[] = [];
  out.push("# Engineering Build Document");
  out.push("");
  const effort = view.effort_summary;
  out.push(
    `**Estimate:** ${effort.total_sprints} sprints, ` +
      `team of ${effort.team_size}${effort.team_size_stated ? "" : " (assumed)"} ` +
      `(${esc(effort.confidence_band)})`,
  );
  if (effort.total_points > 0) {
    // How it was calculated, so the number survives leaving the app.
    out.push("");
    out.push(
      `**How we estimated this:** ${effort.total_points} story points ` +
        `(module sizes x${effort.domain_multiplier} for the domain) at ` +
        `${effort.velocity} points per 2-week sprint.`,
    );
  }
  out.push("");

  out.push("## Modules");
  out.push("");
  out.push("| Module | Size | Stack | Dependencies | Notes |");
  out.push("|--------|------|-------|--------------|-------|");
  for (const m of view.module_table) {
    out.push(
      `| ${tcell(m.name)} | ${m.size} | ${tcell(m.tech_stack.join(", "))} | ${tcell(m.dependencies.join(", ") || "—")} | ${tcell(m.notes)} |`,
    );
  }
  out.push("");

  out.push("### API surface (per module)");
  out.push("");
  for (const m of view.module_table) {
    if (m.api_endpoints.length === 0) continue;
    out.push(`**${esc(m.name)}**`);
    out.push("");
    out.push(fence("http", m.api_endpoints.join("\n")));
    out.push("");
  }

  out.push("## Build order");
  out.push("");
  view.build_order.forEach((name, i) => out.push(`${i + 1}. ${esc(name)}`));
  out.push("");

  if (view.database_sketch.length > 0) {
    out.push("## Database sketch");
    out.push("");
    for (const t of view.database_sketch) {
      out.push(`### \`${esc(t.table)}\``);
      out.push("");
      out.push(fence("sql", t.fields.join("\n")));
      if (t.relations.length > 0) {
        out.push("");
        out.push("Relations:");
        for (const r of t.relations) out.push(`- ${esc(r)}`);
      }
      out.push("");
    }
  }

  out.push("## Auth & RBAC");
  out.push("");
  out.push(`Roles: ${view.auth_model.roles.map(esc).join(", ")}`);
  out.push("");
  out.push("| Role | Permissions |");
  out.push("|------|-------------|");
  for (const role of view.auth_model.roles) {
    const perms = view.auth_model.permissions_matrix[role] ?? [];
    out.push(`| ${tcell(role)} | ${tcell(perms.join(", ") || "—")} |`);
  }
  out.push("");

  if (view.third_party_checklist.length > 0) {
    out.push("## Third-party checklist");
    out.push("");
    for (const item of view.third_party_checklist) out.push(`- [ ] ${esc(item)}`);
    out.push("");
  }

  out.push("## Sprint breakdown");
  out.push("");
  out.push("| Sprint | Focus | Points | Modules |");
  out.push("|--------|-------|--------|---------|");
  for (const s of view.sprint_breakdown) {
    out.push(
      `| ${tcell(s.sprint)} | ${tcell(s.focus)} | ${s.story_points} | ${tcell(s.modules.join(", "))} |`,
    );
  }
  out.push("");

  if (view.testing_strategy.length > 0) {
    out.push("## Testing strategy");
    out.push("");
    out.push("| Module | Unit | Integration | E2E |");
    out.push("|--------|------|-------------|-----|");
    for (const t of view.testing_strategy) {
      out.push(
        `| ${tcell(t.module)} | ${tcell(t.unit)} | ${tcell(t.integration)} | ${tcell(t.e2e)} |`,
      );
    }
    out.push("");
  }

  const securityKeys = Object.keys(view.security_per_module);
  if (securityKeys.length > 0) {
    out.push("## Security per module");
    out.push("");
    for (const mod of securityKeys) {
      out.push(`### ${esc(mod)}`);
      for (const concern of view.security_per_module[mod] ?? []) {
        out.push(`- ${esc(concern)}`);
      }
      out.push("");
    }
  }

  if (view.risks.length > 0) {
    out.push("## Risks");
    out.push("");
    for (const r of view.risks) {
      out.push(`- **${r.severity}** — ${esc(r.description)}`);
    }
    out.push("");
  }

  out.push("## GitHub references");
  out.push("");
  if (view.github_references.length === 0) {
    out.push("No similar public projects found.");
  }
  for (const r of view.github_references) {
    const safeUrl = sanitizeUrl(r.url);
    out.push(`- [${esc(r.repo)}](${safeUrl}) — ${esc(r.why_relevant)}`);
  }
  out.push("");

  return out.join("\n").trimEnd() + "\n";
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
