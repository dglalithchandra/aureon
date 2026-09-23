import { NextRequest, type NextResponse } from "next/server";
import { describe, expect, it } from "vitest";
import { POST as createRoute } from "@/app/api/session/route";
import { GET as getRoute } from "@/app/api/session/[id]/route";
import { putSession } from "@/lib/storage/session";
import {
  buildOwnerCookie,
  buildSessionCookie,
  OWNER_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "@/lib/security/session-cookie";
import type { Session } from "@/lib/schemas/mcq";
import { makeSession } from "../fixtures/llm";

/** BUG-03: one owner cookie per browser; every session it creates stays readable. */

function create(cookie?: string): Promise<NextResponse> {
  return createRoute(
    new NextRequest("http://localhost/api/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({ rawText: "We need an internal tool for account managers." }),
    }),
  );
}

function read(id: string, cookie?: string): Promise<NextResponse> {
  return getRoute(
    new NextRequest(`http://localhost/api/session/${id}`, {
      headers: cookie ? { cookie } : {},
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function sessionOf(res: NextResponse): Promise<Session> {
  return ((await res.json()) as { session: Session }).session;
}

describe("BUG-03: sessions are owned by the browser, not the latest cookie", () => {
  it("two sessions created from one browser are both readable", async () => {
    const first = await create();
    const ownerCookie = first.cookies.get(OWNER_COOKIE_NAME);
    expect(ownerCookie?.value).toBeTruthy();
    expect(ownerCookie?.maxAge).toBe(365 * 24 * 60 * 60);
    const browser = `${OWNER_COOKIE_NAME}=${ownerCookie!.value}`;
    const a = await sessionOf(first);

    const second = await create(browser);
    const b = await sessionOf(second);
    // Creating B must not replace or add any cookie.
    expect(second.cookies.getAll()).toEqual([]);
    expect(b.owner_id).toBe(a.owner_id);

    expect((await read(a.id, browser)).status).toBe(200);
    expect((await read(b.id, browser)).status).toBe(200);
  });

  it("another browser cannot read them", async () => {
    const mine = await create();
    const a = await sessionOf(mine);
    const other = await create(); // a fresh browser gets its own owner id
    const otherBrowser = `${OWNER_COOKIE_NAME}=${other.cookies.get(OWNER_COOKIE_NAME)!.value}`;

    expect((await read(a.id, otherBrowser)).status).toBe(401);
    expect((await read(a.id)).status).toBe(401);
  });

  it("rejects a forged owner cookie and a legacy cookie for an owned session", async () => {
    const res = await create();
    const a = await sessionOf(res);

    const forged = `${OWNER_COOKIE_NAME}=${a.owner_id}.not-the-signature`;
    expect((await read(a.id, forged)).status).toBe(401);

    // Sessions with an owner_id ignore the old per-session cookie.
    const legacy = `${SESSION_COOKIE_NAME}=${buildSessionCookie(a.id).value}`;
    expect((await read(a.id, legacy)).status).toBe(401);
  });

  it("a session cookie value does not pass as an owner cookie", async () => {
    // A project whose owner id happens to equal its own id: the only case
    // where a session cookie could be replayed as an owner cookie.
    const id = "d15ea5e0-0000-4000-8000-0000000000cd";
    const a: Session = makeSession({ id, owner_id: id });
    await putSession(a);
    // `${id}.${sig(id)}` is a valid session cookie but not a valid owner cookie.
    const reused = `${OWNER_COOKIE_NAME}=${buildSessionCookie(a.id).value}`;
    expect((await read(a.id, reused)).status).toBe(401);
    const real = `${OWNER_COOKIE_NAME}=${buildOwnerCookie(a.id).value}`;
    expect((await read(a.id, real)).status).toBe(200);
  });

  it("sessions stored before owner_id still accept their per-session cookie", async () => {
    const legacy = makeSession({
      id: "a1b2c3d4-e5f6-4a7b-8c9d-00000000abcd",
      owner_id: null,
    });
    await putSession(legacy);

    const oldCookie = `${SESSION_COOKIE_NAME}=${buildSessionCookie(legacy.id).value}`;
    expect((await read(legacy.id, oldCookie)).status).toBe(200);

    const someOwner = `${OWNER_COOKIE_NAME}=${buildOwnerCookie("b1b2c3d4-e5f6-4a7b-8c9d-00000000abcd").value}`;
    expect((await read(legacy.id, someOwner)).status).toBe(401);
  });
});
