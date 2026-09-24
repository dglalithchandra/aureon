import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as importRoute } from "@/app/api/import/route";
import { getDatabase } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { MAX_UPLOAD_BYTES } from "@/lib/import/extract";
import { truncateAll } from "../helpers/db";

/**
 * POST /api/import turns a file into text and keeps nothing. The route is
 * the only place an uploaded file exists, and only for the length of one
 * request.
 */

let ip = 0;

function upload(file: File): NextRequest {
  const form = new FormData();
  form.set("file", file);
  ip += 1;
  return new NextRequest("http://localhost/api/import", {
    method: "POST",
    headers: { "x-forwarded-for": `198.51.107.${ip}` },
    body: form,
  });
}

function fileFrom(path: string, name: string, type: string): File {
  return new File([new Uint8Array(readFileSync(path))], name, { type });
}

beforeEach(async () => {
  await truncateAll();
});

describe("uploading a requirements document", () => {
  it("answers with the text of a PDF", async () => {
    const res = await importRoute(
      upload(
        fileFrom(
          "tests/fixtures/import/requirements.pdf",
          "requirements.pdf",
          "application/pdf",
        ),
      ),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      text: string;
      kind: string;
      pages: number | null;
      overBudget: boolean;
      limitBytes: number;
      fileName: string;
    };
    expect(body.kind).toBe("pdf");
    expect(body.pages).toBe(1);
    expect(body.text).toContain("Sellers list handmade items");
    expect(body.overBudget).toBe(false);
    expect(body.limitBytes).toBe(50_000);
    expect(body.fileName).toBe("requirements.pdf");
  });

  it("answers with the text of a DOCX", async () => {
    const res = await importRoute(
      upload(
        fileFrom(
          "tests/fixtures/import/requirements.docx",
          "requirements.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
      ),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string; kind: string };
    expect(body.kind).toBe("docx");
    expect(body.text).toContain("Budget is 40,000 dollars");
  });

  it("stores nothing: no project, no row, nothing to delete later", async () => {
    await importRoute(
      upload(
        fileFrom(
          "tests/fixtures/import/requirements.docx",
          "requirements.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
      ),
    );

    // The session is created later, by POST /api/session, from the text the
    // user approved — importing on its own leaves no trace.
    expect(await getDatabase().select().from(projects)).toHaveLength(0);
  });
});

describe("what the route refuses", () => {
  it("a body that is not multipart", async () => {
    const res = await importRoute(
      new NextRequest("http://localhost/api/import", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.108.1",
        },
        body: JSON.stringify({ file: "nice try" }),
      }),
    );
    expect(res.status).toBe(415);
  });

  it("an upload with no file in it", async () => {
    ip += 1;
    const form = new FormData();
    form.set("notafile", "text");
    const res = await importRoute(
      new NextRequest("http://localhost/api/import", {
        method: "POST",
        headers: { "x-forwarded-for": `198.51.109.${ip}` },
        body: form,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("a file type it cannot read", async () => {
    const res = await importRoute(
      upload(new File(["binary"], "design.sketch", { type: "application/octet-stream" })),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/\.txt, \.md, \.pdf and \.docx/);
  });

  it("a file over 5 MB", async () => {
    const big = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "big.txt", {
      type: "text/plain",
    });
    const res = await importRoute(upload(big));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/limit is 5 MB/);
  });

  it("stops answering when one address uploads too often", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const form = new FormData();
      form.set(
        "file",
        new File(["A marketplace for handmade crafts."], "brief.txt", {
          type: "text/plain",
        }),
      );
      const res = await importRoute(
        new NextRequest("http://localhost/api/import", {
          method: "POST",
          // One address for all twelve: this is the bucket under test.
          headers: { "x-forwarded-for": "198.51.110.7" },
          body: form,
        }),
      );
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(10);
    expect(statuses.at(-1)).toBe(429);
  });
});
