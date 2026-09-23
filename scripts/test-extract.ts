/**
 * Smoke test for runExtraction. Reads GEMINI_API_KEY from .env.local.
 *
 * Usage:
 *   npx tsx scripts/test-extract.ts            # rich SaaS sample (default)
 *   npx tsx scripts/test-extract.ts thin       # thin sample (should blocker)
 *   npx tsx scripts/test-extract.ts fintech    # fintech sample
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runExtraction } from "../lib/pipeline/extract";

// Minimal dotenv: load .env.local into process.env without a dependency.
function loadEnvFile(path: string): void {
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    /* file missing — fall through; env validator will complain */
  }
}

loadEnvFile(join(process.cwd(), ".env.local"));

const SAMPLES: Record<string, string> = {
  rich: `We need to build a SaaS analytics platform for e-commerce store owners.
Users sign up, connect their Shopify or WooCommerce store via OAuth, and see
dashboards with revenue, top products, customer cohorts, and conversion
funnels. Admins can invite team members with read-only or editor roles.
We need Stripe billing with monthly Starter ($29) and Pro ($99) tiers,
14-day free trial, and CSV export of any report. Stack: Next.js, Postgres,
deployed on Vercel. We have $40k budget, want MVP live in 8 weeks. Success
means 50 paying customers in 3 months and <2s dashboard load.`,
  thin: `I want to build an app.`,
  fintech: `Freelancers need a way to invoice their clients in different countries
and get paid quickly. Generate PDF invoices with tax (GST/VAT), send via
email, accept payment via Stripe or Razorpay, and let the freelancer see
unpaid invoices and overdue ones. Compliance with KYC for payouts above
$10,000. Mobile-first.`,
};

async function main(): Promise<void> {
  const which = (process.argv[2] ?? "rich").toLowerCase();
  const sample = SAMPLES[which];
  if (!sample) {
    console.error(
      `Unknown sample "${which}". Choose one of: ${Object.keys(SAMPLES).join(", ")}`,
    );
    process.exit(1);
  }

  console.log(`\n== Sample: ${which} ==`);
  console.log(sample);
  console.log("\n== Running extraction... ==\n");

  const t0 = Date.now();
  const result = await runExtraction({ rawText: sample });
  const ms = Date.now() - t0;

  console.log(`Done in ${ms}ms\n`);
  console.log("Domain:", result.domain, `(${result.domain_confidence}% conf)`);
  console.log("Overall confidence:", result.confidence);
  console.log("Blocker:", result.blocker);
  console.log("Reasoning:", result.confidence_reasoning);
  console.log("\nParameters:");
  for (const p of result.parameters) {
    const ev = p.evidence ? `"${p.evidence.slice(0, 80)}…"` : "—";
    console.log(`  ${p.id} ${p.state.padEnd(13)} ${p.name}`);
    console.log(`        evidence: ${ev}`);
    if (p.gap) console.log(`        gap:      ${p.gap}`);
  }
  console.log(`\nModules (${result.modules.length}):`);
  for (const m of result.modules) {
    console.log(`  [${m.size.padEnd(6)}] ${m.name} — ${m.description}`);
  }
  console.log(`\nAssumptions (${result.assumptions.length}):`);
  for (const a of result.assumptions) console.log(`  · ${a}`);
  console.log(`\nOpen questions (${result.open_questions.length}):`);
  for (const q of result.open_questions) console.log(`  ? ${q}`);
}

main().catch((err: unknown) => {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
