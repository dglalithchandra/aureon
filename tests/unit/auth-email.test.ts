import { afterEach, describe, expect, it, vi } from "vitest";
import { magicLinkHtml, magicLinkText, type sendMagicLink } from "@/lib/auth/email";

/** getServerEnv() memoises, so each case imports the module afresh. */
async function loadSender(): Promise<typeof sendMagicLink> {
  vi.resetModules();
  const mod = await import("@/lib/auth/email");
  return mod.sendMagicLink;
}

/** The magic-link email: what it says, and how it is sent. */

const LINK = {
  url: "https://aureon.example/api/auth/callback/email?token=abc&email=a%40b.c",
  host: "aureon.example",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the message", () => {
  it("carries the link and says what it does", () => {
    const html = magicLinkHtml(LINK);
    expect(html).toContain(LINK.url.replace(/&/g, "&amp;"));
    expect(html).toContain("aureon.example");
    expect(html).toContain("expires in 24 hours");
    expect(magicLinkText(LINK)).toContain(LINK.url);
  });

  it("escapes what it interpolates", () => {
    const html = magicLinkHtml({
      url: "https://evil.example/?x=1&y=2",
      host: '"><script>alert(1)</script>',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("x=1&amp;y=2");
  });

  it("has no images and no tracking pixels", () => {
    expect(magicLinkHtml(LINK)).not.toMatch(/<img/i);
  });
});

describe("sending", () => {
  function configure(): void {
    vi.stubEnv("EMAIL_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "Aureon <hello@aureon.example>");
  }

  it("posts to the configured API with a bearer token", async () => {
    configure();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const sendMagicLink = await loadSender();
    await sendMagicLink({ to: "person@example.com", ...LINK });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer re_test_key",
    );
    const body = JSON.parse(String(init.body)) as { to: string[]; html: string };
    expect(body.to).toEqual(["person@example.com"]);
    expect(body.html).toContain("aureon.example");
  });

  it("uses a different endpoint when one is configured", async () => {
    configure();
    vi.stubEnv("EMAIL_API_URL", "https://api.postmarkapp.com/email");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const sendMagicLink = await loadSender();
    await sendMagicLink({ to: "person@example.com", ...LINK });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://api.postmarkapp.com/email");
  });

  it("throws when the API refuses, so the user is told", async () => {
    configure();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("domain not verified", { status: 403 })),
    );
    const sendMagicLink = await loadSender();
    await expect(sendMagicLink({ to: "person@example.com", ...LINK })).rejects.toThrow(
      /403/,
    );
  });

  it("refuses to pretend it sent anything when unconfigured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const sendMagicLink = await loadSender();
    await expect(sendMagicLink({ to: "person@example.com", ...LINK })).rejects.toThrow(
      /not configured/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
