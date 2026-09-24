import "@/lib/server-only";
import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { ClientView, EngineerView, FinalOutput } from "@/lib/schemas/output";
import { logger } from "@/lib/logger";

/**
 * The scope as a Word document.
 *
 * Every page carries the workspace it belongs to (name and logo, from the
 * workspace settings), the version it was generated from and whether that
 * version has been approved — so a document that leaves the app still says
 * what it is. The footer says the rest: this is an AI-generated draft.
 */

/** The line that goes on every page, and the reason this export exists. */
export const DRAFT_FOOTER = "AI-generated draft — review before sending to a client.";

export type DocxView = "client" | "engineer";

export interface DocxBranding {
  workspaceName: string | null;
  logo: { data: Uint8Array; type: "png" | "jpg" | "gif" | "bmp" } | null;
}

export interface DocxMeta {
  title: string;
  /** The latest version this document matches, when the project has one. */
  versionNumber: number | null;
  /** "Approved v3 — 23 September 2026", when a client has approved it. */
  approvalLabel: string | null;
  approvalState: "approved" | "changes_requested" | null;
  generatedAt: Date;
}

const WHEN = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" });

/** A logo no wider than this many points keeps the header one line tall. */
const LOGO_MAX_WIDTH = 120;
const LOGO_HEIGHT = 36;

export async function buildScopeDocx(options: {
  view: DocxView;
  output: FinalOutput;
  meta: DocxMeta;
  branding: DocxBranding;
}): Promise<Buffer> {
  const { view, output, meta, branding } = options;

  const children =
    view === "client"
      ? clientBody(output.client, meta)
      : engineerBody(output.engineer, meta);

  const doc = new Document({
    creator: "Aureon",
    title: `${meta.title} — ${view === "client" ? "Client view" : "Engineer build document"}`,
    description: DRAFT_FOOTER,
    sections: [
      {
        headers: { default: new Header({ children: headerChildren(branding, meta) }) },
        footers: { default: new Footer({ children: footerChildren(branding) }) },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

function headerChildren(branding: DocxBranding, meta: DocxMeta): Paragraph[] {
  const out: Paragraph[] = [];
  if (branding.logo) {
    out.push(
      new Paragraph({
        children: [
          new ImageRun({
            type: branding.logo.type,
            data: branding.logo.data,
            transformation: { width: LOGO_MAX_WIDTH, height: LOGO_HEIGHT },
            altText: {
              name: "Workspace logo",
              description: branding.workspaceName ?? "Workspace logo",
              title: branding.workspaceName ?? "Workspace logo",
            },
          }),
        ],
      }),
    );
  }
  out.push(
    new Paragraph({
      children: [
        new TextRun({
          text: [branding.workspaceName, meta.title].filter(Boolean).join(" · "),
          bold: true,
          size: 18,
        }),
      ],
    }),
  );
  return out;
}

function footerChildren(branding: DocxBranding): Paragraph[] {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: DRAFT_FOOTER, italics: true, size: 16 }),
        new TextRun({
          text: branding.workspaceName ? `  ·  ${branding.workspaceName}  ·  ` : "  ·  ",
          size: 16,
        }),
        new TextRun({ children: ["Page ", PageNumber.CURRENT], size: 16 }),
      ],
    }),
  ];
}

/** Title block: what this is, which version, and whether it was approved. */
function titleBlock(heading: string, meta: DocxMeta): Paragraph[] {
  const facts = [
    meta.versionNumber ? `Version ${meta.versionNumber}` : "Unversioned draft",
    meta.approvalLabel ??
      (meta.approvalState === "changes_requested"
        ? "Changes requested"
        : "Not approved yet"),
    `Generated ${WHEN.format(meta.generatedAt)}`,
  ];
  return [
    new Paragraph({ text: heading, heading: HeadingLevel.TITLE }),
    new Paragraph({
      children: [new TextRun({ text: facts.join("  ·  "), size: 18, color: "666666" })],
      spacing: { after: 240 },
    }),
  ];
}

function h2(text: string): Paragraph {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 240 },
  });
}

function h3(text: string): Paragraph {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 160 },
  });
}

function bullets(items: readonly string[]): Paragraph[] {
  return items.map((text) => new Paragraph({ text, bullet: { level: 0 } }));
}

function table(header: readonly string[], rows: ReadonlyArray<readonly string[]>): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: header.map(
          (text) =>
            new TableCell({
              children: [
                new Paragraph({
                  children: [new TextRun({ text, bold: true, size: 18 })],
                }),
              ],
            }),
        ),
      }),
      ...rows.map(
        (cells) =>
          new TableRow({
            children: cells.map(
              (text) =>
                new TableCell({
                  children: [
                    new Paragraph({ children: [new TextRun({ text, size: 18 })] }),
                  ],
                }),
            ),
          }),
      ),
    ],
  });
}

/* ──────────────────────────────────────────────────────────────
 *  Client view
 * ────────────────────────────────────────────────────────────── */

function clientBody(view: ClientView, meta: DocxMeta): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [
    ...titleBlock("Project scope — client view", meta),
  ];

  out.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Confidence ${view.confidence_badge.score}/100`,
          bold: true,
        }),
      ],
    }),
  );

  out.push(h2("Summary"), new Paragraph(view.project_summary));

  out.push(h2("Modules"));
  out.push(
    table(
      ["Module", "Size", "Description"],
      view.modules.map((m) => [m.name, m.size, m.description]),
    ),
  );

  out.push(h2("Milestones"));
  for (const milestone of view.milestones) {
    out.push(h3(`${milestone.phase} — ${milestone.name}`));
    out.push(...bullets(milestone.deliverables));
  }

  if (view.assumptions.length > 0) {
    out.push(h2("What we assumed"), ...bullets(view.assumptions));
  }
  if (view.open_items.length > 0) {
    out.push(h2("Open items"), ...bullets(view.open_items));
  }

  return out;
}

/* ──────────────────────────────────────────────────────────────
 *  Engineer view
 * ────────────────────────────────────────────────────────────── */

function engineerBody(view: EngineerView, meta: DocxMeta): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [
    ...titleBlock("Engineering build document", meta),
  ];

  const effort = view.effort_summary;
  out.push(
    new Paragraph({
      children: [
        new TextRun({
          text:
            `${effort.total_sprints} sprints · team of ${effort.team_size}` +
            `${effort.team_size_stated ? "" : " (assumed)"} · ${effort.confidence_band}`,
          bold: true,
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text:
            `${effort.total_points} story points (module sizes ×${effort.domain_multiplier} ` +
            `for the domain) at ${effort.velocity} points per 2-week sprint.`,
          size: 18,
          color: "666666",
        }),
      ],
    }),
  );

  out.push(h2("Modules"));
  out.push(
    table(
      ["Module", "Size", "Stack", "Dependencies", "Notes"],
      view.module_table.map((m) => [
        m.name,
        m.size,
        m.tech_stack.join(", "),
        m.dependencies.join(", ") || "—",
        m.notes || "—",
      ]),
    ),
  );

  const withEndpoints = view.module_table.filter((m) => m.api_endpoints.length > 0);
  if (withEndpoints.length > 0) {
    out.push(h2("API surface"));
    for (const m of withEndpoints) {
      out.push(h3(m.name));
      out.push(
        ...m.api_endpoints.map(
          (endpoint) =>
            new Paragraph({
              children: [new TextRun({ text: endpoint, font: "Consolas", size: 18 })],
            }),
        ),
      );
    }
  }

  out.push(h2("Build order"));
  out.push(
    ...view.build_order.map(
      (name, i) => new Paragraph({ text: `${i + 1}. ${name}`, bullet: { level: 0 } }),
    ),
  );

  if (view.database_sketch.length > 0) {
    out.push(h2("Database sketch"));
    for (const t of view.database_sketch) {
      out.push(h3(t.table));
      out.push(
        ...t.fields.map(
          (field) =>
            new Paragraph({
              children: [new TextRun({ text: field, font: "Consolas", size: 18 })],
            }),
        ),
      );
      if (t.relations.length > 0) out.push(...bullets(t.relations));
    }
  }

  out.push(h2("Auth and RBAC"));
  out.push(
    table(
      ["Role", "Permissions"],
      view.auth_model.roles.map((role) => [
        role,
        (view.auth_model.permissions_matrix[role] ?? []).join(", ") || "—",
      ]),
    ),
  );

  if (view.third_party_checklist.length > 0) {
    out.push(h2("Third-party checklist"), ...bullets(view.third_party_checklist));
  }

  out.push(h2("Sprint breakdown"));
  out.push(
    table(
      ["Sprint", "Focus", "Points", "Modules"],
      view.sprint_breakdown.map((s) => [
        s.sprint,
        s.focus,
        String(s.story_points),
        s.modules.join(", "),
      ]),
    ),
  );

  if (view.testing_strategy.length > 0) {
    out.push(h2("Testing strategy"));
    out.push(
      table(
        ["Module", "Unit", "Integration", "E2E"],
        view.testing_strategy.map((t) => [t.module, t.unit, t.integration, t.e2e]),
      ),
    );
  }

  const securedModules = Object.keys(view.security_per_module);
  if (securedModules.length > 0) {
    out.push(h2("Security per module"));
    for (const name of securedModules) {
      out.push(h3(name), ...bullets(view.security_per_module[name] ?? []));
    }
  }

  if (view.risks.length > 0) {
    out.push(h2("Risks"));
    out.push(...bullets(view.risks.map((r) => `${r.severity} — ${r.description}`)));
  }

  out.push(h2("GitHub references"));
  if (view.github_references.length === 0) {
    out.push(new Paragraph("No similar public projects found."));
  } else {
    out.push(
      ...bullets(
        view.github_references.map((r) => `${r.repo} — ${r.why_relevant} (${r.url})`),
      ),
    );
  }

  return out;
}

/* ──────────────────────────────────────────────────────────────
 *  The workspace logo
 * ────────────────────────────────────────────────────────────── */

/** Two megabytes is a generous logo and a cheap ceiling. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES: Record<string, "png" | "jpg" | "gif" | "bmp"> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/bmp": "bmp",
};

/**
 * The workspace logo as bytes, from a `data:` URI or an https URL.
 *
 * A data URI needs no network at all. An https URL is fetched with a
 * timeout, a size cap and a content-type check — it is set by a workspace
 * owner, not by a visitor, but a server that fetches a URL on request
 * still gets the shortest leash that does the job. Anything else (http,
 * file, a URL that fails, an image type Word cannot place) returns null
 * and the document goes out with the workspace name alone.
 */
export async function loadWorkspaceLogo(
  logoUrl: string | null,
): Promise<DocxBranding["logo"]> {
  if (!logoUrl) return null;

  try {
    if (logoUrl.startsWith("data:")) {
      const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(logoUrl);
      if (!match) return null;
      const type = LOGO_TYPES[match[1]!.toLowerCase()];
      if (!type) return null;
      const data = Buffer.from(match[2]!, "base64");
      if (data.byteLength === 0 || data.byteLength > MAX_LOGO_BYTES) return null;
      return { data: new Uint8Array(data), type };
    }

    const url = new URL(logoUrl);
    if (url.protocol !== "https:") return null;

    const res = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const type =
      LOGO_TYPES[(res.headers.get("content-type") ?? "").split(";")[0]!.trim()];
    if (!type) return null;
    const data = new Uint8Array(await res.arrayBuffer());
    if (data.byteLength === 0 || data.byteLength > MAX_LOGO_BYTES) return null;
    return { data, type };
  } catch (err) {
    logger.warn("export.logo_failed", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }
}
