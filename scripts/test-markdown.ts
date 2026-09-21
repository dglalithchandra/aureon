/**
 * Smoke tests for the markdown exporters.
 *   npx tsx scripts/test-markdown.ts
 *
 * Confirms:
 *   - Client + Engineer markdown rendering for a representative payload
 *   - Pipe-in-cell escaping
 *   - URL sanitization (javascript: → #)
 *   - No raw HTML emitted
 */
import {
  clientToMarkdown,
  engineerToMarkdown,
  finalOutputToMarkdown,
} from "../lib/export/markdown";
import type { ClientView, EngineerView } from "../lib/schemas/output";

const client: ClientView = {
  project_summary:
    "An analytics platform that helps online store owners understand their sales. Owners connect their store, see dashboards, and export reports.",
  modules: [
    {
      name: "Auth",
      description: "User accounts and sign-in (with pipe | character)",
      size: "MEDIUM",
      github_validated: true,
    },
    {
      name: "Dashboard",
      description: "Revenue and product metrics",
      size: "LARGE",
      github_validated: false,
    },
  ],
  milestones: [
    {
      phase: "Month 1",
      name: "Foundation",
      deliverables: ["Sign up flow", "Connect store"],
    },
    {
      phase: "Month 2",
      name: "Core dashboard",
      deliverables: ["Revenue charts", "Top products"],
    },
  ],
  assumptions: ["Multi-tenant by team account"],
  open_items: ["Which payment provider for billing?"],
  confidence_badge: {
    score: 72,
    breakdown: { coverage: 75, llm_quality: 80, github_validation: 60 },
  },
};

const engineer: EngineerView = {
  module_table: [
    {
      name: "Auth",
      tech_stack: ["NextAuth.js", "PostgreSQL"],
      size: "MEDIUM",
      dependencies: [],
      api_endpoints: ["POST /api/auth/login — issue session"],
      notes: "JWT in HttpOnly cookie",
    },
  ],
  build_order: ["Auth", "Dashboard"],
  database_sketch: [
    {
      table: "users",
      fields: ["id UUID PRIMARY KEY", "email TEXT UNIQUE NOT NULL"],
      relations: [],
    },
  ],
  auth_model: {
    roles: ["admin", "editor"],
    permissions_matrix: {
      admin: ["modules:read", "modules:write"],
      editor: ["modules:read"],
    },
  },
  third_party_checklist: ["Stripe — create account, set up webhook endpoint"],
  sprint_breakdown: [
    {
      sprint: "Sprint 1",
      focus: "Auth + sessions",
      story_points: 26,
      modules: ["Auth"],
    },
  ],
  testing_strategy: [
    {
      module: "Auth",
      unit: "Password hashing",
      integration: "Login endpoint",
      e2e: "Full login flow",
    },
  ],
  security_per_module: { Auth: ["Rate limit login", "HttpOnly cookies"] },
  risks: [{ severity: "WARNING", description: "Session secret rotation" }],
  github_references: [
    {
      repo: "ok/repo",
      url: "https://github.com/ok/repo",
      why_relevant: "similar auth flow",
    },
    {
      repo: "bad",
      url: "javascript:alert(1)",
      why_relevant: "should be sanitized",
    },
  ],
  effort_summary: { total_sprints: 6, team_size: 3, confidence_band: "±20%" },
};

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("== clientToMarkdown ==");
const cmd = clientToMarkdown(client);
check("starts with H1", cmd.startsWith("# Project Scope"));
check("contains confidence", cmd.includes("72/100"));
check("contains modules table", cmd.includes("| # | Module |"));
check(
  "escapes pipe in cell",
  cmd.includes("pipe \\| character"),
  "Found pipe was not escaped",
);
check("no raw <script>", !cmd.includes("<script"));
check("no raw <iframe>", !cmd.includes("<iframe"));

console.log("\n== engineerToMarkdown ==");
const emd = engineerToMarkdown(engineer);
check("starts with H1", emd.startsWith("# Engineering Build Document"));
check("includes module table", emd.includes("| Module | Size | Stack"));
check("includes build order", emd.includes("## Build order"));
check("renders SQL fence", emd.includes("```sql"));
check("RBAC table present", emd.includes("| admin |"));
check("checklist uses checkbox", emd.includes("- [ ] "));
check("javascript: URL sanitized", emd.includes("](#)"));
check("legitimate URL preserved", emd.includes("https://github.com/ok/repo"));
check("no raw HTML", !emd.includes("<script") && !emd.includes("<iframe"));

console.log("\n== combined ==");
const combined = finalOutputToMarkdown({ client, engineer });
check(
  "contains both H1s",
  combined.includes("# Project Scope") &&
    combined.includes("# Engineering Build Document"),
);
check("has separator", combined.includes("---"));

console.log(`\n== ${pass} passed, ${fail} failed ==`);
if (fail > 0) process.exit(1);
