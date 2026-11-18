import { describe, expect, it } from "vitest";
import {
  markOutputManuallyEdited,
  reconcileOutput,
} from "@/lib/pipeline/output-consistency";
import {
  makeClientView,
  makeEngineerView,
  makeExtraction,
  makeRound,
  makeSession,
} from "../fixtures/llm";

describe("deterministic output consistency", () => {
  it("restores extracted modules and aligns the client timeline with engineering", () => {
    const session = makeSession({ rounds: [makeRound()] });
    const output = reconcileOutput(session, {
      client: makeClientView(),
      engineer: makeEngineerView(),
    });

    expect(output.client.modules.map((module) => module.name)).toEqual([
      "Auth",
      "Admin",
      "Users",
    ]);
    expect(output.engineer.module_table.map((module) => module.name)).toEqual([
      "Auth",
      "Admin",
      "Users",
    ]);
    expect(output.engineer.build_order).toEqual(["Auth", "Admin", "Users"]);
    expect(output.client.milestones.map((milestone) => milestone.phase)).toEqual(
      output.engineer.sprint_breakdown.map((sprint) => sprint.sprint),
    );
    expect(output.consistency_report?.consistent).toBe(true);
    expect(
      output.consistency_report?.issues.some((issue) => issue.severity === "repaired"),
    ).toBe(true);
  });

  it("caps confidence and exposes a stated timeline conflict", () => {
    const extraction = makeExtraction({
      parameters: makeExtraction().parameters.map((parameter) =>
        parameter.id === "P-08"
          ? {
              ...parameter,
              state: "PRESENT" as const,
              evidence: "The pilot must launch in 2 weeks.",
              gap: null,
            }
          : parameter,
      ),
    });
    const session = makeSession({ rounds: [makeRound({ extraction })] });
    const engineer = makeEngineerView();
    engineer.effort_summary.total_sprints = 4;
    engineer.sprint_breakdown = Array.from({ length: 4 }, (_, index) => ({
      sprint: `Sprint ${index + 1}`,
      focus: `Phase ${index + 1}`,
      story_points: 10,
      modules: ["Auth"],
    }));
    const client = makeClientView();
    client.confidence_badge.score = 90;
    client.confidence_badge.breakdown.cap_applied = 100;

    const output = reconcileOutput(session, { client, engineer });
    expect(output.consistency_report?.consistent).toBe(false);
    expect(output.client.confidence_badge.score).toBe(65);
    expect(output.client.confidence_badge.breakdown.cap_applied).toBe(65);
    expect(output.engineer.risks).toContainEqual(
      expect.objectContaining({ rule_id: "timeline-constraint" }),
    );
  });

  it("invalidates a generated report after a manual edit", () => {
    const output = markOutputManuallyEdited({
      client: makeClientView(),
      engineer: makeEngineerView(),
    });
    expect(output.consistency_report).toMatchObject({
      consistent: false,
      issues: [{ code: "MANUAL_EDIT_REVIEW_REQUIRED", severity: "warning" }],
    });
  });
});
