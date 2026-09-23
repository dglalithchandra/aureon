import "@/lib/server-only";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Sending the magic link.
 *
 * Over an HTTPS email API rather than SMTP, because the SMTP route means
 * `nodemailer`, which currently carries four high-severity advisories with
 * no fixed version (address-parsing and allow-list bypasses). This project's
 * CI fails on a high advisory, and weakening that gate to keep a transport
 * would be the wrong trade.
 *
 * Any API that accepts `{from, to, subject, html, text}` with a bearer token
 * works; EMAIL_API_URL defaults to Resend's endpoint.
 */

const DEFAULT_ENDPOINT = "https://api.resend.com/emails";

export interface MagicLinkEmail {
  to: string;
  url: string;
  /** The host shown to the reader, so a link to another site is obvious. */
  host: string;
}

export function magicLinkHtml({ url, host }: Omit<MagicLinkEmail, "to">): string {
  // Deliberately plain: inline styles only, no images, no tracking.
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px;background:#0b0d12;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;color:#e7e9ee">
    <div style="max-width:480px;margin:0 auto">
      <p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#8b93a7;margin:0 0 24px">Aureon</p>
      <h1 style="font-size:22px;line-height:1.3;margin:0 0 12px">Sign in to Aureon</h1>
      <p style="font-size:14px;line-height:1.6;color:#b8bfd0;margin:0 0 24px">
        Click the button below to sign in at ${escapeHtml(host)}. The link works once and expires in 24 hours.
      </p>
      <p style="margin:0 0 24px">
        <a href="${escapeHtml(url)}" style="display:inline-block;background:#7dd3fc;color:#0b0d12;font-weight:600;font-size:14px;text-decoration:none;padding:12px 20px;border-radius:10px">Sign in</a>
      </p>
      <p style="font-size:12px;line-height:1.6;color:#8b93a7;margin:0">
        If you did not ask for this, ignore it — nothing happens until the link is opened.
      </p>
    </div>
  </body>
</html>`;
}

export function magicLinkText({ url, host }: Omit<MagicLinkEmail, "to">): string {
  return [
    `Sign in to Aureon at ${host}`,
    "",
    url,
    "",
    "The link works once and expires in 24 hours.",
    "If you did not ask for this, ignore it.",
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Send one magic link. Throws so Auth.js can show the user a failure. */
export async function sendMagicLink({ to, url, host }: MagicLinkEmail): Promise<void> {
  const env = getServerEnv();
  if (!env.EMAIL_API_KEY || !env.EMAIL_FROM) {
    throw new Error("Email sign-in is not configured (EMAIL_API_KEY, EMAIL_FROM)");
  }

  const res = await fetch(env.EMAIL_API_URL ?? DEFAULT_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.EMAIL_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [to],
      subject: `Sign in to Aureon`,
      html: magicLinkHtml({ url, host }),
      text: magicLinkText({ url, host }),
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    logger.error("auth.magic_link_failed", { status: res.status, detail });
    throw new Error(`Could not send the sign-in email (${res.status})`);
  }
  logger.info("auth.magic_link_sent", { host });
}
