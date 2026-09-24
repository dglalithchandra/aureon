import Link from "next/link";
import { DEFAULT_RAW_INPUT_RETENTION_DAYS } from "@/lib/db/schema";
import { SHARE_EXPIRY_DAYS } from "@/lib/db/schema";

export const metadata = {
  title: "Privacy — Aureon",
  description: "What Aureon does with the text you paste, and who else sees it.",
};

/**
 * The privacy notice (PRIV-01).
 *
 * Client requirements are often confidential and sometimes contain personal
 * data, so this page says plainly what is stored, who processes it, how
 * long it stays and how to delete it. It describes what the code actually
 * does — if the code changes, this page changes with it.
 */

const SUBPROCESSORS = [
  {
    name: "Google (Gemini API)",
    role: "Reads the brief and the answers to extract requirements and write the scope.",
    data: "The text you paste, your answers, and the README text of matched public repositories.",
    note: "Sent with store: false, so it is not kept in Google's history. The OpenRouter path in the code is a local development option and routes to third-party model providers; it is not used in production.",
  },
  {
    name: "Vercel",
    role: "Runs the application and serves every page.",
    data: "Request metadata: IP address, user agent, URL, timing.",
    note: "",
  },
  {
    name: "Neon (Postgres)",
    role: "Stores projects, rounds, versions, share links and accounts.",
    data: "Everything the app keeps, including the brief and the generated documents.",
    note: "",
  },
  {
    name: "Upstash (Redis, QStash)",
    role: "Rate limits, locks, cached GitHub results and the background job queue.",
    data: "Session ids, IP-derived counters, job payloads that name a session id.",
    note: "No brief text is written to Redis.",
  },
  {
    name: "GitHub",
    role: "Searched for similar public projects.",
    data: "Search terms derived from the brief — the domain and a few feature words, never the brief itself.",
    note: "",
  },
  {
    name: "Resend (or your email API)",
    role: "Sends magic-link sign-in emails and change-request notifications.",
    data: "Email address and the message.",
    note: "Only when a sign-in method is configured.",
  },
];

export default function PrivacyPage(): React.ReactElement {
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
          Privacy
        </h1>
        <p className="text-blueprint-muted text-sm">
          What happens to the text you paste. Written to match the code, not to cover it.
        </p>
      </header>

      <Section title="Please don't paste secrets">
        <p>
          Aureon is built for requirements, not credentials. Don&apos;t paste API keys,
          passwords, card numbers, government identifiers, health records, or a client
          list with named individuals. If your brief mentions a person, a first name and a
          role is enough for the scope — the model never needs their contact details.
        </p>
      </Section>

      <Section title="What is stored">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>The brief you paste, and every clarification answer.</li>
          <li>
            The generated documents, and one immutable version per generation or saved
            edit.
          </li>
          <li>
            Share links, with the mode and expiry you chose, and any approval decision.
          </li>
          <li>
            For an approval: the approver&apos;s name, optional email, the time, and a
            salted SHA-256 hash of their IP address. The address itself is never stored.
          </li>
          <li>An audit entry for creations, deletions, shares and approvals.</li>
          <li>
            If you sign in: your email address, and the Google account id when you use
            Google.
          </li>
        </ul>
        <p className="mt-3">
          Application logs deliberately exclude the brief and the answers; they carry ids,
          timings and error codes.
        </p>
      </Section>

      <Section title="How long it stays">
        <p>
          The raw brief is deleted after{" "}
          <strong>{DEFAULT_RAW_INPUT_RETENTION_DAYS} days</strong> of inactivity by a
          daily job; the generated documents are kept, because they are the thing you came
          for. A workspace can shorten that period. A share link expires after the period
          chosen when it was made ({SHARE_EXPIRY_DAYS.join(", ")} days) and can be revoked
          at any time, which takes effect immediately.
        </p>
      </Section>

      <Section title="Deleting it">
        <p>
          Open{" "}
          <Link href="/projects" className="underline">
            your scopes
          </Link>{" "}
          and delete the one you want gone, or use &quot;Delete this scope&quot; on the
          scope itself. A delete is a hard delete: the project, its rounds, its versions,
          its approvals and its share links go with it, and any link someone was holding
          stops working at once. The audit entry recording the deletion is kept.
        </p>
      </Section>

      <Section title="Who else processes it">
        <div className="flex flex-col gap-4">
          {SUBPROCESSORS.map((p) => (
            <div
              key={p.name}
              className="border-blueprint-line/20 rounded-xl border bg-white/[0.02] p-4"
            >
              <h3 className="text-blueprint-text font-semibold">{p.name}</h3>
              <p className="mt-1">{p.role}</p>
              <p className="text-blueprint-muted mt-1 text-[13px]">
                <span className="font-mono text-[10px] tracking-[0.16em] uppercase">
                  Sees
                </span>{" "}
                {p.data}
              </p>
              {p.note && (
                <p className="text-blueprint-muted mt-1 text-[13px]">{p.note}</p>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Calibration">
        <p>
          When a finished project&apos;s actuals are recorded, what is stored is the weeks
          it took, the team size, a 1–5 accuracy rating, your note, and per module the
          size and the sprints — beside the estimate as it stood. It stays in your
          workspace and shapes your own future estimates.
        </p>
        <p className="mt-3">
          Sharing those numbers with other workspaces is <strong>off</strong> unless a
          workspace owner turns it on. When it is on, what crosses the boundary is
          aggregate numbers and the fixed domain label — never the note, the module names,
          the title or the project id. Turning it off removes the workspace from the pool
          at once.
        </p>
      </Section>

      <Section title="Anyone with the link">
        <p>
          A share link is a capability: anyone holding it can read the snapshot it points
          at until it expires or is revoked, with no account and no sign-in. Treat it like
          an unlisted URL, not like a password-protected page. An approval link can record
          one decision and nothing else — it cannot edit, revoke or list anything.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          This is a student project, not a company. Questions, or a request to delete
          something you cannot reach yourself, go to the repository&apos;s issue tracker.
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
