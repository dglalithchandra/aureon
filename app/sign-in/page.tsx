import Link from "next/link";
import { redirect } from "next/navigation";
import { authEnabled, signIn } from "@/lib/auth/auth";
import { getViewerFromCookies } from "@/lib/auth/viewer";
import { getServerEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sign in — Aureon",
  robots: { index: false },
};

/**
 * Sign in with a magic link or with Google. Whatever the browser scoped
 * while signed out comes with it: lib/auth/viewer.ts claims those projects
 * the first time the account is seen.
 */
export default async function SignInPage(): Promise<React.ReactElement> {
  const viewer = await getViewerFromCookies();
  if (viewer.userId) redirect("/projects");

  const env = getServerEnv();
  const google = Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);
  const email = Boolean(env.EMAIL_API_KEY && env.EMAIL_FROM);

  async function signInWithEmail(formData: FormData): Promise<void> {
    "use server";
    const address = String(formData.get("email") ?? "").trim();
    if (!address) return;
    await signIn("email", { email: address, redirectTo: "/projects" });
  }

  async function signInWithGoogle(): Promise<void> {
    "use server";
    await signIn("google", { redirectTo: "/projects" });
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-4 py-16">
      <div className="flex flex-col gap-2">
        <Link
          href="/"
          className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase hover:text-[var(--color-blueprint-accent)]"
        >
          ← Aureon
        </Link>
        <h1 className="text-blueprint-text font-display text-3xl font-bold">Sign in</h1>
        <p className="text-blueprint-muted text-sm leading-relaxed">
          Your scopes follow your account, on every device. Anything you scoped on this
          browser without an account comes with you.
        </p>
      </div>

      {!authEnabled() && (
        <div className="border-blueprint-line/30 text-blueprint-muted rounded-xl border bg-white/[0.02] p-4 text-sm leading-relaxed">
          Sign-in is not configured on this deployment yet. Set{" "}
          <code className="font-mono text-xs">AUTH_GOOGLE_ID</code> and{" "}
          <code className="font-mono text-xs">AUTH_GOOGLE_SECRET</code>, or{" "}
          <code className="font-mono text-xs">EMAIL_API_KEY</code> and{" "}
          <code className="font-mono text-xs">EMAIL_FROM</code>, then restart. You can
          keep using Aureon without an account in the meantime — one scope at a time.
        </div>
      )}

      {email && (
        <form action={signInWithEmail} className="flex flex-col gap-3">
          <label
            htmlFor="email"
            className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase"
          >
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
            className="border-blueprint-line/30 text-blueprint-text rounded-xl border bg-white/[0.03] px-4 py-3 text-sm focus:border-[var(--color-blueprint-accent)]/60 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-xl bg-[var(--color-blueprint-accent)] px-4 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90"
          >
            Email me a sign-in link
          </button>
        </form>
      )}

      {email && google && (
        <div className="text-blueprint-muted flex items-center gap-3 text-[11px]">
          <span className="bg-blueprint-line/20 h-px flex-1" />
          or
          <span className="bg-blueprint-line/20 h-px flex-1" />
        </div>
      )}

      {google && (
        <form action={signInWithGoogle}>
          <button
            type="submit"
            className="border-blueprint-line/30 text-blueprint-text w-full rounded-xl border bg-white/[0.03] px-4 py-3 text-sm font-medium transition-colors hover:border-[var(--color-blueprint-accent)]/40"
          >
            Continue with Google
          </button>
        </form>
      )}

      <p className="text-blueprint-muted text-xs leading-relaxed">
        We store your email address to identify your account, and nothing else about you.
        Scopes you create are visible only to you and to anyone you invite.
      </p>
    </main>
  );
}
