import Link from "next/link";
import { connection } from "next/server";

export const metadata = {
  title: "Check your email — Aureon",
  robots: { index: false },
};

/**
 * Where Auth.js sends the browser after a magic link goes out. Rendered per
 * request so its scripts can carry the CSP nonce (SEC-03).
 */
export default async function CheckEmailPage(): Promise<React.ReactElement> {
  await connection();
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
