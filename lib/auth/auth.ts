import "@/lib/server-only";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import type { EmailConfig } from "next-auth/providers";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getDatabase } from "@/lib/db/client";
import { accounts, authSessions, users, verificationTokens } from "@/lib/db/schema";
import { getServerEnv } from "@/lib/env";
import { sendMagicLink } from "@/lib/auth/email";
import { logger } from "@/lib/logger";

/**
 * Auth.js, with its tables in this project's own Postgres.
 *
 * Two ways in, both optional so the app still runs before either is
 * configured (and so the tests need neither):
 *
 *   Google     AUTH_GOOGLE_ID + AUTH_GOOGLE_SECRET
 *   magic link EMAIL_API_KEY + EMAIL_FROM — sent over an HTTPS email API
 *              (see lib/auth/email.ts for why not SMTP)
 *
 * The session strategy is "database": the browser holds an opaque token and
 * the row lives in auth_sessions, so signing in on a second device reads the
 * same account rather than a copy of a JWT. lib/auth/viewer.ts resolves that
 * token straight from the request, which keeps route handlers testable.
 *
 * The whole config is built per request, not at module load. `next build`
 * imports this file while collecting page data, where there is no database
 * and no credentials — a config built eagerly would fail the build.
 */

function providers(): NextAuthConfig["providers"] {
  const env = getServerEnv();
  const list: NextAuthConfig["providers"] = [];

  if (env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) {
    list.push(
      Google({
        clientId: env.AUTH_GOOGLE_ID,
        clientSecret: env.AUTH_GOOGLE_SECRET,
        // Ask for nothing beyond identity.
        authorization: { params: { scope: "openid email profile" } },
      }),
    );
  }
  if (env.EMAIL_API_KEY && env.EMAIL_FROM) {
    list.push(magicLinkProvider(env.EMAIL_FROM));
  }
  return list;
}

/**
 * The magic-link provider, defined here rather than imported: Auth.js's
 * built-in email provider goes through nodemailer, and this one goes through
 * lib/auth/email.ts instead. Everything else — token generation, the
 * verification_tokens table, the callback — is Auth.js's own.
 */
function magicLinkProvider(from: string): EmailConfig {
  return {
    id: "email",
    type: "email",
    name: "Email",
    from,
    maxAge: 24 * 60 * 60,
    options: {},
    async sendVerificationRequest({ identifier, url }) {
      await sendMagicLink({ to: identifier, url, host: new URL(url).host });
    },
  };
}

export function authConfig(): NextAuthConfig {
  return {
    adapter: DrizzleAdapter(getDatabase(), {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: authSessions,
      verificationTokensTable: verificationTokens,
    }),
    session: { strategy: "database", maxAge: 30 * 24 * 60 * 60 },
    providers: providers(),
    pages: { signIn: "/sign-in", verifyRequest: "/sign-in/check-email" },
    callbacks: {
      session({ session, user }) {
        // The user id is what every authorisation check compares against.
        if (session.user) session.user.id = user.id;
        return session;
      },
    },
    events: {
      signIn({ user, isNewUser }) {
        logger.info("auth.sign_in", { userId: user.id, isNewUser: isNewUser === true });
      },
    },
    trustHost: true,
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

/** True when at least one way to sign in is configured. */
export function authEnabled(): boolean {
  return providers().length > 0;
}
