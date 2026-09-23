import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { NextRequest, type NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { POST as shareRoute } from "@/app/api/share/route";
import { DELETE as revokeRoute } from "@/app/api/share/[token]/route";
import { PATCH as patchRoute } from "@/app/api/session/[id]/route";
import SharePage from "@/app/share/[token]/page";
import { resolveShareToken } from "@/lib/storage/share";
import { deleteSession, putSession } from "@/lib/storage/session";
import { buildOwnerCookie, OWNER_COOKIE_NAME } from "@/lib/security/session-cookie";
import type { Session } from "@/lib/schemas/mcq";
import type { FinalOutput } from "@/lib/schemas/output";
import {
  makeClientView,
  makeEngineerView,
  makeRound,
  makeSession,
} from "../fixtures/llm";

/** BUG-04: share links render from a snapshot and can be revoked. */

// The read-only view is framer-motion heavy; show just what the tests check.
vi.mock("@/components/output/ReadOnlyOutput", () => ({
  ReadOnlyOutput: ({ output }: { output: FinalOutput }) =>
    createElement("section", null, output.client.project_summary),
}));

const OWNER = "c0ffee00-0000-4000-8000-000000000001";
const STRANGER = "c0ffee00-0000-4000-8000-000000000002";
const cookieFor = (ownerId: string) =>
  `${OWNER_COOKIE_NAME}=${buildOwnerCookie(ownerId).value}`;

let n = 0;
async function finalizedSession(): Promise<Session> {
  n++;
  const session = makeSession({
    id: `d0d0d0d0-0000-4000-8000-${String(n).padStart(12, "0")}`,
    raw_input: "Marketplace for handmade crafts. Sellers list items.",
    status: "finalized",
    pipeline_stage: null,
    owner_id: OWNER,
    rounds: [makeRound()],
    final_output: {
      client: {
        ...makeClientView(),
        project_summary: "Original summary of the marketplace scope",
      },
      engineer: makeEngineerView(),
    },
  });
  await putSession(session);
  return session;
}

interface ShareBody {
  token: string;
  url: string;
  created_at: number;
  reused: boolean;
}

async function share(sessionId: string, cookie = cookieFor(OWNER), title?: string) {
  const res = await shareRoute(
    new NextRequest("http://localhost/api/share", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ sessionId, title }),
    }),
  );
  return { status: res.status, body: (await res.json()) as ShareBody };
}

function revoke(token: string, cookie = cookieFor(OWNER)): Promise<NextResponse> {
  return revokeRoute(
    new NextRequest(`http://localhost/api/share/${token}`, {
      method: "DELETE",
      headers: { cookie },
    }),
    { params: Promise.resolve({ token }) },
  );
}

async function renderShare(token: string): Promise<string> {
  return renderToString(await SharePage({ params: Promise.resolve({ token }) }));
}

describe("POST /api/share", () => {
  it("stores a snapshot and returns the same active link when shared again", async () => {
    const session = await finalizedSession();
    const first = await share(session.id);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      url: `/share/${first.body.token}`,
      reused: false,
    });

    const again = await share(session.id);
    expect(again.body).toMatchObject({
      token: first.body.token,
      created_at: first.body.created_at,
      reused: true,
    });
  });

  it("is owner only", async () => {
    const session = await finalizedSession();
    expect((await share(session.id, cookieFor(STRANGER))).status).toBe(401);
  });
});

describe("share page", () => {
  it("renders from its own snapshot, with the title it was shared under", async () => {
    const session = await finalizedSession();
    const { body } = await share(session.id, cookieFor(OWNER), "Craft marketplace MVP");

    const html = await renderShare(body.token);
    expect(html).toContain("Craft marketplace MVP");
    expect(html).toContain("Original summary of the marketplace scope");
    expect(html).toContain("Snapshot taken");
    expect(html).toContain("Re-share to include later edits.");
  });

  it("goes down with the project when the project is deleted", async () => {
    // Deleting a project is a hard delete: its shares go too, so a link
    // cannot outlive the data it was made from.
    const session = await finalizedSession();
    const { body } = await share(session.id);
    await deleteSession(session.id);

    expect(await resolveShareToken(body.token)).toBeNull();
  });

  it("shows the snapshot, not edits made after sharing", async () => {
    const session = await finalizedSession();
    const { body } = await share(session.id);

    const edited = {
      ...session.final_output!,
      client: {
        ...session.final_output!.client,
        project_summary: "Edited summary of the marketplace scope",
      },
    };
    const patched = await patchRoute(
      new NextRequest(`http://localhost/api/session/${session.id}`, {
        method: "PATCH",
        headers: { cookie: cookieFor(OWNER), "content-type": "application/json" },
        body: JSON.stringify({ final_output: edited }),
      }),
      { params: Promise.resolve({ id: session.id }) },
    );
    expect(patched.status).toBe(200);

    const html = await renderShare(body.token);
    expect(html).toContain("Original summary of the marketplace scope");
    expect(html).not.toContain("Edited summary of the marketplace scope");
  });

  it("derives the title from the input when none is sent", async () => {
    const session = await finalizedSession();
    const { body } = await share(session.id);
    expect(await renderShare(body.token)).toContain("Marketplace for handmade crafts");
  });
});

describe("DELETE /api/share/[token]", () => {
  it("a revoked token returns 404, and sharing again makes a new link", async () => {
    const session = await finalizedSession();
    const { body } = await share(session.id);

    const res = await revoke(body.token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revoked: true });

    await expect(renderShare(body.token)).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
    expect((await revoke(body.token)).status).toBe(404);

    const again = await share(session.id);
    expect(again.body.reused).toBe(false);
    expect(again.body.token).not.toBe(body.token);
  });

  it("is owner only", async () => {
    const session = await finalizedSession();
    const { body } = await share(session.id);

    expect((await revoke(body.token, cookieFor(STRANGER))).status).toBe(401);
    expect((await revoke(body.token, "")).status).toBe(401);
    expect(await renderShare(body.token)).toContain(
      "Original summary of the marketplace scope",
    );
    expect((await revoke(body.token)).status).toBe(200);
  });
});
