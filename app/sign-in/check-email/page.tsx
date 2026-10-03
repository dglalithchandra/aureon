import Link from "next/link";

/**
 * Never cached, always rendered for the request that asked for it. The
 * strict CSP puts a fresh nonce on every script tag (SEC-03), and a page
 * served from the full route cache would carry the nonce of whoever
 * rendered it first — which matches no later response's header, so every
 * script on it is blocked. `connection()` alone did not prevent that.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Check your email — Aureon",
  robots: { index: false },
};

/**
 * Where Auth.js sends the browser after a magic link goes out. Rendered per
 * request so its scripts can carry the CSP nonce (SEC-03).
 */
export default function CheckEmailPage(): React.ReactElement {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-blueprint-text font-display text-3xl font-bold">
        Check your email
      </h1>
      <p className="text-blueprint-muted text-sm leading-relaxed">
        We sent you a sign-in link. It works once and expires in 24 hours. If it has not
        arrived in a minute, look in spam — the sender is whatever address this deployment
        is configured to send from.
      </p>
      <Link
        href="/sign-in"
        className="text-sm text-[var(--color-blueprint-accent)] underline decoration-dotted underline-offset-4"
      >
        Use a different address
      </Link>
    </main>
  );
}
