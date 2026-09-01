/**
 * Smoke test for the GitHub enrichment layer.
 *
 *   npx tsx scripts/test-github.ts             # SaaS analytics sample
 *   npx tsx scripts/test-github.ts search-only # only test the GH search wiring (no Anthropic calls)
 *
 * Requires ANTHROPIC_API_KEY for the full path. The search-only mode runs
 * even without it (uses anonymous GitHub, 60 req/hr, fine for one run).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
    /* env validator handles missing vars */
  }
}

loadEnvFile(join(process.cwd(), ".env.local"));

const SAMPLE_RAW =
  "We need a SaaS analytics platform for ecommerce store owners. " +
  "Users connect their Shopify or WooCommerce store, see dashboards with " +
  "revenue, top products, and conversion funnels. Stripe billing with " +
  "Starter and Pro tiers, team invitations, CSV export.";

import type { ExtractionResult } from "../lib/schemas/extraction";

const SAMPLE_EXTRACTION: ExtractionResult = {
  domain: "SaaS",
  domain_confidence: 92,
  parameters: [
    { id: "P-01", name: "Project Goal", state: "PRESENT", evidence: "SaaS analytics platform for ecommerce store owners", gap: null },
    { id: "P-02", name: "Target Users", state: "PARTIAL_DEEP", evidence: "ecommerce store owners, team members", gap: "Roles per team (admin/editor/viewer)?" },
    { id: "P-03", name: "Core Features", state: "PRESENT", evidence: "dashboards, revenue, top products, conversion funnels, Stripe billing, team invitations, CSV export", gap: null },
    { id: "P-04", name: "Tech Stack", state: "MISSING", evidence: null, gap: "Stack preference?" },
    { id: "P-05", name: "Integrations", state: "PRESENT", evidence: "Shopify, WooCommerce, Stripe", gap: null },
    { id: "P-06", name: "NFRs", state: "MISSING", evidence: null, gap: null },
    { id: "P-07", name: "Budget", state: "MISSING", evidence: null, gap: null },
    { id: "P-08", name: "Timeline", state: "MISSING", evidence: null, gap: null },
    { id: "P-09", name: "Success Metrics", state: "MISSING", evidence: null, gap: null },
  ],
  modules: [
    { name: "Auth", description: "User accounts and login", size: "MEDIUM", source_signal: "standard for SaaS", github_validated: false },
    { name: "Dashboard", description: "Revenue and product metrics", size: "MEDIUM", source_signal: "explicit feature", github_validated: false },
    { name: "Billing", description: "Stripe-based subscription billing", size: "LARGE", source_signal: "Stripe billing", github_validated: false },
    { name: "Team Management", description: "Invite and manage members", size: "MEDIUM", source_signal: "team invitations", github_validated: false },
    { name: "CSV Export", description: "Download reports", size: "SMALL", source_signal: "CSV export", github_validated: false },
    { name: "Shopify Integration", description: "Connect Shopify store", size: "MEDIUM", source_signal: "Shopify", github_validated: false },
  ],
  assumptions: ["Multi-tenant"],
  open_questions: ["Tech stack?"],
  confidence: 64,
  confidence_reasoning: "P-01/P-03 strong; budget/timeline/NFR all missing.",
  blocker: false,
};

async function main(): Promise<void> {
  const mode = (process.argv[2] ?? "full").toLowerCase();
  console.log("Mode:", mode);
  console.log();

  if (mode === "search-only") {
    const { searchRepos, buildSearchQuery } = await import("../lib/github/search");
    const q = buildSearchQuery({ domain: "SaaS", keywords: ["analytics", "dashboard", "ecommerce"] });
    console.log("Query:", q);
    const r = await searchRepos({ domain: "SaaS", keywords: ["analytics", "dashboard", "ecommerce"] });
    console.log(`Got ${r.results.length} results:`);
    for (const item of r.results) {
      console.log(`  ★ ${item.stars.toString().padStart(7)}  ${item.repo}`);
      console.log(`             ${item.description.slice(0, 100)}`);
    }
    return;
  }

  const { enrichWithGitHub } = await import("../lib/pipeline/github-enrich");
  const { mergeGitHubSignals } = await import("../lib/pipeline/merge");

  const t0 = Date.now();
  const enrichment = await enrichWithGitHub(SAMPLE_EXTRACTION, SAMPLE_RAW);
  console.log(`Enrichment in ${Date.now() - t0}ms`);
  console.log("Query:", enrichment.query_used);
  console.log(`Matches (${enrichment.matches.length}):`);
  for (const m of enrichment.matches) {
    console.log(`  sim=${m.similarity.toFixed(2)}  ${m.repo}  ★${m.stars}`);
    console.log(`    modules: ${m.modules_found.slice(0, 8).join(", ")}${m.modules_found.length > 8 ? "…" : ""}`);
  }
  console.log();
  console.log("Module frequency:");
  const sorted = Object.entries(enrichment.module_frequency).sort((a, b) => b[1] - a[1]);
  for (const [name, count] of sorted) console.log(`  ${count}x  ${name}`);

  const merged = mergeGitHubSignals(SAMPLE_EXTRACTION, enrichment);
  console.log();
  console.log("Merged modules:");
  for (const m of merged.modules) {
    const tag = m.github_validated ? "✓ gh" : "    ";
    console.log(`  ${tag}  [${m.size}]  ${m.name}`);
  }
}

main().catch((err: unknown) => {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
