import { describe, expect, it } from "vitest";
import {
  clientToMarkdown,
  engineerToMarkdown,
  finalOutputToMarkdown,
} from "@/lib/export/markdown";
import type { ClientView, EngineerView } from "@/lib/schemas/output";

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
    breakdown: {
      coverage: 75,
      ai_clarity: 80,
      consistency: 95,
      github_bonus: 0,
      cap_applied: 100,
    },
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
    { sprint: "Sprint 1", focus: "Auth + sessions", story_points: 26, modules: ["Auth"] },
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
    { repo: "bad", url: "javascript:alert(1)", why_relevant: "should be sanitized" },
  ],
  effort_summary: { total_sprints: 6, team_size: 3, confidence_band: "±20%" },
};

describe("clientToMarkdown", () => {
  const md = clientToMarkdown(client);

  it("renders the document header and confidence", () => {
    expect(md.startsWith("# Project Scope")).toBe(true);
    expect(md).toContain("72/100");
  });

  it("renders the modules table and escapes pipes inside cells", () => {
    expect(md).toContain("| # | Module |");
    expect(md).toContain("pipe \\| character");
  });

  it("emits no raw HTML", () => {
    expect(md).not.toContain("<script");
    expect(md).not.toContain("<iframe");
  });
});

describe("engineerToMarkdown", () => {
  const md = engineerToMarkdown(engineer);

  it("renders every section", () => {
    expect(md.startsWith("# Engineering Build Document")).toBe(true);
    expect(md).toContain("| Module | Size | Stack");
    expect(md).toContain("## Build order");
    expect(md).toContain("```sql");
    expect(md).toContain("| admin |");
    expect(md).toContain("- [ ] ");
  });

  it("replaces a javascript: URL with # and keeps https links", () => {
    expect(md).toContain("](#)");
    expect(md).not.toContain("javascript:");
    expect(md).toContain("https://github.com/ok/repo");
  });

  it("emits no raw HTML", () => {
    expect(md).not.toContain("<script");
    expect(md).not.toContain("<iframe");
  });
});

describe("finalOutputToMarkdown", () => {
  it("combines both documents with a separator", () => {
    const md = finalOutputToMarkdown({ client, engineer });
    expect(md).toContain("# Project Scope");
    expect(md).toContain("# Engineering Build Document");
    expect(md).toContain("---");
  });
});
