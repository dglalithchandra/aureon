import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  buildScopeDocx,
  DRAFT_FOOTER,
  loadWorkspaceLogo,
  type DocxMeta,
} from "@/lib/export/docx";
import type { FinalOutput } from "@/lib/schemas/output";
import { makeClientView, makeEngineerView } from "../fixtures/llm";

/**
 * The Word export. A .docx is a zip of XML, so these tests open the file the
 * way Word would and read what is actually in it.
 */

const OUTPUT: FinalOutput = {
  client: makeClientView(),
  engineer: makeEngineerView(),
};

const META: DocxMeta = {
  title: "Account manager console",
  versionNumber: 3,
  approvalLabel: "Approved v3 — 23 September 2026",
  approvalState: "approved",
  generatedAt: new Date("2026-09-24T09:00:00Z"),
};

/** A 1×1 transparent PNG, so no image file has to live in the repository. */
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function open(buffer: Buffer): Promise<JSZip> {
  return JSZip.loadAsync(buffer);
}

async function xml(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`${path} is not in the document`);
  return file.async("string");
}

/** Every footer part, joined: docx numbers them (footer1.xml, footer2.xml). */
async function footers(zip: JSZip): Promise<string> {
  const parts = zip.file(/word\/footer\d*\.xml/);
  const texts = await Promise.all(parts.map((p) => p.async("string")));
  return texts.join("\n");
}

async function headers(zip: JSZip): Promise<string> {
  const parts = zip.file(/word\/header\d*\.xml/);
  const texts = await Promise.all(parts.map((p) => p.async("string")));
  return texts.join("\n");
}

/** XML splits a run at odd places; compare on the text content alone. */
function plain(xmlText: string): string {
  return xmlText.replace(/<[^>]+>/g, "");
}

describe("the client document", () => {
  it("says on every page that it is an AI-generated draft", async () => {
    const zip = await open(
      await buildScopeDocx({
        view: "client",
        output: OUTPUT,
        meta: META,
        branding: { workspaceName: "Acme Studio", logo: null },
      }),
    );

    expect(plain(await footers(zip))).toContain(DRAFT_FOOTER);
    expect(DRAFT_FOOTER).toContain("AI-generated draft");
  });

  it("carries the workspace, the version and the approval", async () => {
    const zip = await open(
      await buildScopeDocx({
        view: "client",
        output: OUTPUT,
        meta: META,
        branding: { workspaceName: "Acme Studio", logo: null },
      }),
    );

    expect(plain(await headers(zip))).toContain("Acme Studio");
    const body = plain(await xml(zip, "word/document.xml"));
    expect(body).toContain("Version 3");
    expect(body).toContain("Approved v3");
    expect(plain(await footers(zip))).toContain("Acme Studio");
  });

  it("says so when nothing has been approved yet", async () => {
    const zip = await open(
      await buildScopeDocx({
        view: "client",
        output: OUTPUT,
        meta: {
          ...META,
          versionNumber: null,
          approvalLabel: null,
          approvalState: null,
        },
        branding: { workspaceName: null, logo: null },
      }),
    );

    const body = plain(await xml(zip, "word/document.xml"));
    expect(body).toContain("Unversioned draft");
    expect(body).toContain("Not approved yet");
  });

  it("holds the scope itself, not just its covers", async () => {
    const zip = await open(
      await buildScopeDocx({
        view: "client",
        output: OUTPUT,
        meta: META,
        branding: { workspaceName: "Acme Studio", logo: null },
      }),
    );

    const body = plain(await xml(zip, "word/document.xml"));
    expect(body).toContain("Project scope — client view");
    expect(body).toContain(OUTPUT.client.project_summary);
    expect(body).toContain(OUTPUT.client.modules[0]!.name);
    expect(body).toContain(OUTPUT.client.milestones[0]!.name);
    expect(body).toContain(OUTPUT.client.open_items[0]!);
  });

  it("puts the logo in the document when the workspace has one", async () => {
    const zip = await open(
      await buildScopeDocx({
        view: "client",
        output: OUTPUT,
        meta: META,
        branding: {
          workspaceName: "Acme Studio",
          logo: { data: Buffer.from(PNG_1PX, "base64"), type: "png" },
        },
      }),
    );

    expect(zip.file(/word\/media\/.*/).length).toBeGreaterThan(0);
    expect(await headers(zip)).toContain("<w:drawing>");
  });
});

describe("the engineer document", () => {
  it("has the footer, the estimate and the tables", async () => {
    const zip = await open(
      await buildScopeDocx({
        view: "engineer",
        output: OUTPUT,
        meta: META,
        branding: { workspaceName: "Acme Studio", logo: null },
      }),
    );

    expect(plain(await footers(zip))).toContain(DRAFT_FOOTER);
    const body = plain(await xml(zip, "word/document.xml"));
    expect(body).toContain("Engineering build document");
    expect(body).toContain("story points");
    expect(body).toContain(OUTPUT.engineer.module_table[0]!.name);
    expect(body).toContain(OUTPUT.engineer.sprint_breakdown[0]!.sprint);
    expect(body).toContain("Auth and RBAC");
  });
});

describe("the workspace logo", () => {
  it("reads a data URI without going near the network", async () => {
    const logo = await loadWorkspaceLogo(`data:image/png;base64,${PNG_1PX}`);
    expect(logo?.type).toBe("png");
    expect(logo?.data.byteLength).toBeGreaterThan(0);
  });

  it("is nothing when the workspace has not set one", async () => {
    expect(await loadWorkspaceLogo(null)).toBeNull();
    expect(await loadWorkspaceLogo("")).toBeNull();
  });

  it("refuses a scheme that is not https or data", async () => {
    expect(await loadWorkspaceLogo("http://example.com/logo.png")).toBeNull();
    expect(await loadWorkspaceLogo("file:///etc/passwd")).toBeNull();
    expect(await loadWorkspaceLogo("javascript:alert(1)")).toBeNull();
  });

  it("refuses an image type Word cannot place", async () => {
    expect(await loadWorkspaceLogo(`data:image/svg+xml;base64,${PNG_1PX}`)).toBeNull();
  });
});
