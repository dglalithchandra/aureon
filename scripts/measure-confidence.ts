/**
 * ARCH-01: how much does the confidence number move between identical runs?
 *
 * Runs the same briefs through the real extraction model several times and
 * reports, per brief, the standard deviation of
 *
 *   before  the model's own number (what the score used to be), and
 *   after   the computed score (what the score is now).
 *
 * Both come from the same runs, so the comparison is like for like and costs
 * one set of calls. It also counts how often the ready/ask decision (score >=
 * the exit threshold) flips between runs of the same brief.
 *
 * MANUAL ONLY — this calls the real provider and spends real tokens
 * (inputs x runs extraction calls; the default is 10 x 5 = 50 model calls).
 *
 * Usage:
 *   npx tsx scripts/measure-confidence.ts               # 10 briefs x 5 runs
 *   npx tsx scripts/measure-confidence.ts --runs=3
 *   npx tsx scripts/measure-confidence.ts --inputs=3 --runs=2   # a cheap smoke test
 *
 * Env: GEMINI_API_KEY (or OPENROUTER_API_KEY with LLM_PROVIDER=openrouter),
 * read from .env.local like the other scripts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runExtraction } from "@/lib/pipeline/extract";
import { computeConfidence } from "@/lib/scoring/confidence";
import { SCOPING } from "@/lib/config/scoping";

function loadEnvFile(path: string): void {
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const key = t.slice(0, eq).trim();
      let value = t.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    /* ignore */
  }
}

loadEnvFile(join(process.cwd(), ".env.local"));

const arg = (name: string, fallback: number): number => {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

const RUNS = arg("runs", 5);
const INPUT_COUNT = arg("inputs", 10);

/** Ten briefs, thin to rich, so the spread is measured across the range. */
const BRIEFS: Array<{ label: string; text: string }> = [
  { label: "vague-shop", text: "Something for my shop." },
  {
    label: "salon-booking",
    text: "A booking tool for my salon. Clients pick a stylist and a time, pay a deposit online, and get a reminder the day before.",
  },
  {
    label: "internal-tool",
    text: "We need an internal tool so our account managers can manage client accounts. Staff log in, admins manage roles.",
  },
  {
    label: "marketplace",
    text: "A marketplace for handmade crafts. Sellers list items with photos and pricing, buyers check out via Stripe, the platform takes 8% commission with weekly payouts. Reviews, search by category, basic admin dashboard. Launch in 12 weeks.",
  },
  {
    label: "invoicing",
    text: "Freelancers invoice clients in different countries and get paid quickly. Generate PDF invoices with tax (GST/VAT), send by email, accept Stripe or Razorpay, see unpaid and overdue invoices. KYC for payouts above $10k. Mobile-first.",
  },
  {
    label: "saas-analytics",
    text: "A SaaS analytics platform for ecommerce store owners. Users connect Shopify or WooCommerce via OAuth and see dashboards with revenue, top products and conversion funnels. Stripe billing with Starter and Pro tiers, team invitations with editor/viewer roles, CSV export. Next.js and Postgres on Vercel. $40k budget, MVP in 8 weeks, 50 paying customers in 3 months.",
  },
  {
    label: "clinic-portal",
    text: "A patient portal for a physiotherapy clinic: patients book appointments, upload referral letters and see exercise plans; physios manage schedules and notes. Must be HIPAA compliant, integrate with the existing practice-management system over its REST API, and work on phones. Two physios and a receptionist use it daily. Live before the new clinic opens in April.",
  },
  {
    label: "logistics",
    text: "Dispatchers assign deliveries to drivers and track them live. Drivers use an Android app with offline support; dispatchers use a web board. Integrations: Google Maps for routing, Twilio for SMS updates. 200 drivers, 5,000 deliveries a day, 99.9% uptime. Budget around $120k over 6 months. Success: 20% fewer late deliveries.",
  },
  {
    label: "lms",
    text: "A learning platform for a coaching institute. Students watch recorded lessons, take timed quizzes and see progress; teachers upload content and grade. Payments via Razorpay, content on S3. Around 5,000 students. Launch before the June intake.",
  },
  {
    label: "one-liner",
    text: "An app like Uber but for dog walkers.",
  },
];

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Population standard deviation — the spread of these runs, not an estimate. */
function stdev(values: number[]): number {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

const fmt = (n: number): string => n.toFixed(1).padStart(5);

async function main(): Promise<void> {
  const briefs = BRIEFS.slice(0, INPUT_COUNT);
  console.log(
    `Measuring ${briefs.length} briefs x ${RUNS} runs = ${briefs.length * RUNS} real extraction calls.`,
  );
  console.log(
    `Provider: ${process.env.LLM_PROVIDER ?? "gemini"} · exit threshold ${SCOPING.confidenceThreshold}\n`,
  );
  console.log(
    "brief             before: mean   sd  |  after: mean   sd  | ready/ask flips",
  );

  const allBefore: number[] = [];
  const allAfter: number[] = [];
  let flippedBriefs = 0;

  for (const brief of briefs) {
    const before: number[] = [];
    const after: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      const extraction = await runExtraction({ rawText: brief.text });
      before.push(extraction.confidence);
      after.push(computeConfidence(extraction).score);
    }
    allBefore.push(stdev(before));
    allAfter.push(stdev(after));

    const decisions = new Set(after.map((s) => s >= SCOPING.confidenceThreshold));
    const oldDecisions = new Set(before.map((s) => s >= SCOPING.confidenceThreshold));
    const flips = `${oldDecisions.size > 1 ? "before" : "-"} / ${decisions.size > 1 ? "AFTER" : "-"}`;
    if (decisions.size > 1) flippedBriefs++;

    console.log(
      `${brief.label.padEnd(17)} ${fmt(mean(before))} ${fmt(stdev(before))}  | ` +
        `${fmt(mean(after))} ${fmt(stdev(after))}  | ${flips}`,
    );
  }

  console.log(
    `\nMean standard deviation across briefs: before ${mean(allBefore).toFixed(2)} → after ${mean(allAfter).toFixed(2)}`,
  );
  console.log(
    `Briefs whose ready/ask decision flipped between identical runs (after): ${flippedBriefs}/${briefs.length}`,
  );
  console.log(
    "\nThe 'after' spread is whatever the clarity read contributes (30% weight,\n" +
      "and only where it disagrees with coverage); the parameter states carry the rest.",
  );
}

main().catch((err: unknown) => {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
