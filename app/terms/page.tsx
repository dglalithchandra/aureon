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
  title: "Terms — Aureon",
  description: "The terms of using Aureon, and what it does not promise.",
};

/**
 * Terms of use (PRIV-01). Short, and honest about what a generated scope is
 * and is not: a starting point produced by a language model, not a
 * professional estimate anyone should sign a contract against unread.
 */
/**
 * Rendered per request: a page built before the request exists has no CSP
 * nonce, so its scripts are blocked and the page arrives unhydrated.
 */
export default function TermsPage(): React.ReactElement {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12 sm:py-16">
      <header className="flex flex-col gap-2">
        <Link
          href="/"
          className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase hover:text-[var(--color-blueprint-accent)]"
        >
          ← Aureon
        </Link>
        <h1 className="text-blueprint-text font-display text-3xl font-bold sm:text-4xl">
          Terms
        </h1>
      </header>

      <Section title="What this is">
        <p>
          Aureon turns a requirements brief into two documents: a plain-English client
          view and an engineer build doc. The parameter states, the confidence score, the
          risks and the effort estimate are computed by the application; the wording
          around them is written by a language model.
        </p>
      </Section>

      <Section title="What it is not">
        <p>
          It is not a quote, a contract, a professional estimate or legal advice. Sprint
          counts and ranges come from module sizes and a team velocity, not from knowledge
          of your team. A confidence score below the threshold means the scope is a draft
          and says so on the page. Read a scope before you send it to a client, and
          correct it — every section is editable for exactly that reason.
        </p>
      </Section>

      <Section title="What you are responsible for">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Having the right to paste the text you paste, including any confidentiality
            obligation you owe the client it came from.
          </li>
          <li>
            Not pasting credentials, payment details, government identifiers or health
            records (see{" "}
            <Link href="/privacy" className="underline">
              Privacy
            </Link>
            ).
          </li>
          <li>
            Who you give a share link to, and revoking it when it is no longer needed.
          </li>
          <li>Checking the output before you rely on it.</li>
        </ul>
      </Section>

      <Section title="Acceptable use">
        <p>
          Don&apos;t use Aureon to generate content that is unlawful, to probe or overload
          the service, or to work around its rate limits. Automated use is limited per IP
          address and per account; the limits are part of the service, not an obstacle to
          route around.
        </p>
      </Section>

      <Section title="Availability">
        <p>
          This is a student project offered as-is, with no uptime promise and no warranty.
          It depends on third-party services (see{" "}
          <Link href="/privacy" className="underline">
            Privacy
          </Link>
          ) and can stop working when they do. Keep your own copy of anything you need —
          every scope exports to Markdown and PDF.
        </p>
      </Section>

      <Section title="Your content">
        <p>
          What you paste stays yours, and so does what the app generates from it. Aureon
          claims no ownership and does not use your briefs to train anything. Deleting a
          scope deletes it, as described in{" "}
          <Link href="/privacy" className="underline">
            Privacy
          </Link>
          .
        </p>
      </Section>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-blueprint-text font-display text-xl font-bold">{title}</h2>
      <div className="text-blueprint-muted text-sm leading-relaxed">{children}</div>
    </section>
  );
}
