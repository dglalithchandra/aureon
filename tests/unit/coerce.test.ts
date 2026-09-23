import { describe, expect, it } from "vitest";
import { coerceClientView, coerceEngineerView } from "@/lib/pipeline/coerce";
import { ClientViewSchema, EngineerViewSchema } from "@/lib/schemas/output";
import { makeClientView, makeEngineerView } from "../fixtures/llm";

type Obj = Record<string, unknown>;

function asObj(value: unknown): Obj {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected an object");
  }
  return value as Obj;
}

describe("coerceClientView", () => {
  it.each([[null], ["text"], [42], [["array"]]])(
    "passes non-object input through (%j)",
    (input) => {
      expect(coerceClientView(input)).toBe(input);
    },
  );

  it("leaves an already-valid client view unchanged", () => {
    const view = makeClientView();
    expect(coerceClientView(view)).toEqual(view);
  });

  it("wraps single strings in arrays and rounds badge numbers", () => {
    const messy = {
      ...makeClientView(),
      milestones: [{ phase: "Month 1", name: "Foundation", deliverables: "Sign-in" }],
      assumptions: "Single organisation.",
      open_items: "Confirm the budget.",
      confidence_badge: {
        score: 87.5,
        breakdown: {
          coverage: 70.4,
          ai_clarity: 80.6,
          consistency: 90.5,
          github_bonus: 0.2,
          cap_applied: 100,
        },
      },
    };

    const out = asObj(coerceClientView(messy));

    expect(out.milestones).toEqual([
      { phase: "Month 1", name: "Foundation", deliverables: ["Sign-in"] },
    ]);
    expect(out.assumptions).toEqual(["Single organisation."]);
    expect(out.open_items).toEqual(["Confirm the budget."]);
    expect(out.confidence_badge).toEqual({
      score: 88,
      breakdown: {
        coverage: 70,
        ai_clarity: 81,
        consistency: 91,
        github_bonus: 0,
        cap_applied: 100,
      },
    });
    expect(ClientViewSchema.safeParse(out).success).toBe(true);
  });

  it("does not mutate its input", () => {
    const messy = { ...makeClientView(), assumptions: "One" };
    const before = structuredClone(messy);
    coerceClientView(messy);
    expect(messy).toEqual(before);
  });
});

describe("coerceEngineerView", () => {
  it.each([[null], ["text"], [42], [["array"]]])(
    "passes non-object input through (%j)",
    (input) => {
      expect(coerceEngineerView(input)).toBe(input);
    },
  );

  it("leaves an already-valid engineer view unchanged", () => {
    const view = makeEngineerView();
    expect(coerceEngineerView(view)).toEqual(view);
  });

  it("repairs the common weak-model shapes so the schema accepts them", () => {
    const messy = {
      ...makeEngineerView(),
      module_table: [
        {
          name: "Auth",
          tech_stack: "Next.js",
          size: "MEDIUM",
          dependencies: "Users",
          api_endpoints: null,
          notes: 42,
        },
      ],
      build_order: "Auth",
      database_sketch: [{ table: "users", fields: "id UUID", relations: null }],
      testing_strategy: {
        Auth: { unit: "hashing", integration: "login", e2e: "sign-in flow" },
        Billing: "later",
      },
      security_per_module: [
        { module: "Auth", items: ["Rate-limit login", 7] },
        { name: "Billing", concerns: ["PCI scope"] },
        { items: ["no name, dropped"] },
      ],
      auth_model: {
        roles: ["admin", "viewer"],
        permissions_matrix: [
          { role: "admin", permissions: ["accounts:write"] },
          { role: "viewer" },
        ],
      },
      risks: [
        { severity: "critical", description: "No budget" },
        { severity: "urgent", description: "Unknown severity" },
        { description: "Missing severity" },
      ],
      sprint_breakdown: [
        { sprint: "Sprint 1", focus: "Auth", story_points: 12.6, modules: ["Auth"] },
      ],
      effort_summary: { total_sprints: 0.2, team_size: 2.5, confidence_band: "x" },
    };

    const out = asObj(coerceEngineerView(messy));

    expect(out.module_table).toEqual([
      {
        name: "Auth",
        tech_stack: ["Next.js"],
        size: "MEDIUM",
        dependencies: ["Users"],
        api_endpoints: [],
        notes: "42",
      },
    ]);
    expect(out.build_order).toEqual(["Auth"]);
    expect(out.database_sketch).toEqual([
      { table: "users", fields: ["id UUID"], relations: [] },
    ]);
    expect(out.testing_strategy).toEqual([
      { module: "Auth", unit: "hashing", integration: "login", e2e: "sign-in flow" },
      { module: "Billing", unit: "—", integration: "—", e2e: "—" },
    ]);
    expect(out.security_per_module).toEqual({
      Auth: ["Rate-limit login"],
      Billing: ["PCI scope"],
    });
    expect(asObj(out.auth_model).permissions_matrix).toEqual({
      admin: ["accounts:write"],
      viewer: [],
    });
    expect(out.risks).toEqual([
      { severity: "CRITICAL", description: "No budget" },
      { severity: "NOTE", description: "Unknown severity" },
      { severity: "NOTE", description: "Missing severity" },
    ]);
    expect(out.sprint_breakdown).toEqual([
      { sprint: "Sprint 1", focus: "Auth", story_points: 13, modules: ["Auth"] },
    ]);
    expect(out.effort_summary).toEqual({
      total_sprints: 1,
      team_size: 3,
      confidence_band: "x",
    });

    const parsed = EngineerViewSchema.safeParse(out);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("does not mutate its input", () => {
    const messy = { ...makeEngineerView(), build_order: "Auth" };
    const before = structuredClone(messy);
    coerceEngineerView(messy);
    expect(messy).toEqual(before);
  });
});
