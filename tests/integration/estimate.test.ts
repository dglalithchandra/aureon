import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateEngineerView } from "@/lib/pipeline/finalize";
import { EngineerViewSchema } from "@/lib/schemas/output";
import { estimateEffort } from "@/lib/scoring/effort";
import { SCOPING } from "@/lib/config/scoping";
import type { Session } from "@/lib/schemas/mcq";
import type { ModuleCandidate } from "@/lib/schemas/extraction";
import { startMockAnthropic, type MockAnthropic } from "../mocks/mock-anthropic";
import {
  makeEngineerView,
  makeExtraction,
  makeParameters,
  makeRound,
  makeSession,
} from "../fixtures/llm";

/**
 * Blueprint steps 09 and 10 through the finalize pipeline: the numbers are
 * computed on the server, handed to the model as facts, and written back
 * over its answer. A model that argues with them loses.
 */

let mock: MockAnthropic;

beforeAll(async () => {
  mock = await startMockAnthropic();
  process.env.ANTHROPIC_BASE_URL = mock.url;
});

afterAll(async () => {
  await mock.close();
});

beforeEach(() => {
  mock.reset();
});

function mod(name: string, size: ModuleCandidate["size"]): ModuleCandidate {
  return {
    name,
    description: `${name} module`,
    size,
    source_signal: "Mentioned in brief",
    github_validated: false,
    module_confidence: null,
    seen_in: [],
  };
}

const MODULES = [
  mod("Auth", "MEDIUM"),
  mod("Billing", "LARGE"),
  mod("Dashboard", "MEDIUM"),
  mod("Settings", "SMALL"),
];

/** A SaaS session with four modules and a team size nobody stated. */
function saasSession(overrides: Partial<Session> = {}): Session {
  return makeSession({
    status: "ready",
    pipeline_stage: null,
    current_confidence: 84,
    raw_input: "A SaaS analytics tool for store owners.",
    rounds: [
      makeRound({
        extraction: makeExtraction({ domain: "SaaS", modules: MODULES }),
      }),
    ],
    ...overrides,
  });
}

/** What the engine says, independently of the pipeline. */
const expected = estimateEffort({
  modules: MODULES,
  domain: "SaaS",
  confidence: 84,
  teamSize: SCOPING.defaultTeamSize,
});

describe("the estimate is computed, not written by the model", () => {
  it("replaces every number the model sent", async () => {
    // The fixture already sends 3 sprints, a team of 2 and "LLM guess".
    const view = await generateEngineerView(saasSession());

    // 23 + 44 + 23 + 9 = 99 points at velocity 26 → 4 sprints.
    expect(expected.totalPoints).toBe(99);
    expect(view.effort_summary).toEqual({
      total_sprints: 4,
      team_size: 3,
      confidence_band: "±20%",
      total_points: 99,
      velocity: 26,
      domain_multiplier: 1.1,
      team_size_stated: false,
      basis: [
        { name: "Auth", size: "MEDIUM", points: 23 },
        { name: "Billing", size: "LARGE", points: 44 },
        { name: "Dashboard", size: "MEDIUM", points: 23 },
        { name: "Settings", size: "SMALL", points: 9 },
      ],
    });
    expect(EngineerViewSchema.safeParse(view).success).toBe(true);
  });

  it("holds even when the model sends a wildly different estimate", async () => {
    mock.override("submit_engineer_view", {
      ...makeEngineerView(),
      effort_summary: {
        total_sprints: 60,
        team_size: 30,
        confidence_band: "±5% (certain)",
        total_points: 10_000,
        velocity: 200,
        domain_multiplier: 3,
        team_size_stated: true,
        basis: [{ name: "Invented", size: "LARGE", points: 500 }],
      },
      sprint_breakdown: Array.from({ length: 12 }, (_, i) => ({
        sprint: `Week ${i}`,
        focus: `Focus ${i}`,
        story_points: 200,
        modules: ["Invented"],
      })),
    });

    const view = await generateEngineerView(saasSession());
    expect(view.effort_summary.total_sprints).toBe(4);
    expect(view.effort_summary.team_size).toBe(3);
    expect(view.effort_summary.confidence_band).toBe("±20%");
    expect(view.effort_summary.basis.map((b) => b.name)).not.toContain("Invented");

    // The plan is the engine's: four sprints, its modules, its points.
    expect(view.sprint_breakdown).toHaveLength(4);
    expect(view.sprint_breakdown.map((s) => s.sprint)).toEqual([
      "Sprint 1",
      "Sprint 2",
      "Sprint 3",
      "Sprint 4",
    ]);
    expect(view.sprint_breakdown.map((s) => s.story_points)).toEqual([26, 26, 26, 21]);
    expect(view.sprint_breakdown.every((s) => !s.modules.includes("Invented"))).toBe(
      true,
    );
    // … but the model's words survive, which is what it was asked for.
    expect(view.sprint_breakdown[0]?.focus).toBe("Focus 0");
  });

  it("uses the team size the client stated, in the brief or in an answer", async () => {
    const view = await generateEngineerView(
      saasSession({ raw_input: "A SaaS analytics tool. We are a team of 6 engineers." }),
    );
    expect(view.effort_summary.team_size).toBe(6);
    expect(view.effort_summary.team_size_stated).toBe(true);
    // Velocity 45 → ceil(99 / 45) = 3 sprints.
    expect(view.effort_summary.velocity).toBe(45);
    expect(view.effort_summary.total_sprints).toBe(3);
  });

  it("falls back to a focus line of its own when the model writes none", async () => {
    mock.override("submit_engineer_view", {
      ...makeEngineerView(),
      sprint_breakdown: [
        { sprint: "Sprint 1", focus: "Auth first", story_points: 1, modules: [] },
      ],
    });
    const view = await generateEngineerView(saasSession());
    expect(view.sprint_breakdown[0]?.focus).toBe("Auth first");
    expect(view.sprint_breakdown[1]?.focus).toMatch(/^Build /);
  });

  it("tells the model the numbers before it writes", async () => {
    await generateEngineerView(saasSession());
    const prompt = mock.callsFor("submit_engineer_view")[0]?.userText ?? "";
    expect(prompt).toContain("<computed_estimate>");
    expect(prompt).toContain("total_sprints: 4");
    expect(prompt).toContain("total_points: 99");
    expect(prompt).toContain("velocity: 26");
    expect(prompt).toContain("Sprint 1: Auth, Billing — 26 pts");
    // The client document never sees the estimate block.
    expect(mock.callsFor("submit_client_view")[0]?.userText ?? "").not.toContain(
      "<computed_estimate>",
    );
  });
});

describe("the risks are computed, not written by the model", () => {
  /** FinTech, payments in scope, P-05 MISSING: two rules fire. */
  function riskySession(): Session {
    return makeSession({
      status: "ready",
      pipeline_stage: null,
      current_confidence: 70,
      rounds: [
        makeRound({
          extraction: makeExtraction({
            domain: "FinTech",
            modules: [mod("Payments", "LARGE"), mod("KYC", "MEDIUM")],
            parameters: makeParameters({ "P-05": "MISSING" }),
          }),
        }),
      ],
    });
  }

  it("keeps the rule set and the severities the engine decided", async () => {
    mock.override("submit_engineer_view", {
      ...makeEngineerView(),
      risks: [
        // The model tries to downgrade a CRITICAL rule …
        {
          severity: "NOTE",
          description: "Payments are fine, pick a provider later.",
          rule_id: "integrations-unspecified",
        },
        // … and to drop the compliance one by not answering it.
      ],
    });

    const view = await generateEngineerView(riskySession());
    const byRule = new Map(view.risks.map((r) => [r.rule_id, r]));

    expect([...byRule.keys()]).toEqual(["integrations-unspecified", "domain-compliance"]);
    expect(byRule.get("integrations-unspecified")?.severity).toBe("CRITICAL");
    // Its wording is the model's, because wording is what it was asked for.
    expect(byRule.get("integrations-unspecified")?.description).toBe(
      "Payments are fine, pick a provider later.",
    );
    // The rule it ignored is still there, with the engine's own words.
    expect(byRule.get("domain-compliance")?.severity).toBe("WARNING");
    expect(byRule.get("domain-compliance")?.description).toContain("KYC");
  });

  it("keeps up to three risks the model raised on its own, tagged as such", async () => {
    mock.override("submit_engineer_view", {
      ...makeEngineerView(),
      risks: Array.from({ length: 6 }, (_, i) => ({
        severity: "WARNING" as const,
        description: `Model risk ${i}`,
        rule_id: "model",
      })),
    });

    const view = await generateEngineerView(riskySession());
    const extras = view.risks.filter((r) => r.rule_id === "model");
    expect(extras).toHaveLength(3);
    expect(extras[0]?.description).toBe("Model risk 0");
    // The computed ones come first, most severe first.
    expect(view.risks[0]?.rule_id).toBe("integrations-unspecified");
  });

  it("writes the computed risks into the prompt", async () => {
    await generateEngineerView(riskySession());
    const prompt = mock.callsFor("submit_engineer_view")[0]?.userText ?? "";
    expect(prompt).toContain("<computed_risks>");
    expect(prompt).toContain("integrations-unspecified [CRITICAL]");
    expect(prompt).toContain("domain-compliance [WARNING]");
  });

  it("leaves the list empty when no rule fires and the model adds nothing", async () => {
    mock.override("submit_engineer_view", { ...makeEngineerView(), risks: [] });
    const view = await generateEngineerView(saasSession());
    expect(view.risks).toEqual([]);
  });
});
