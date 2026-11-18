import "@/lib/server-only";
import type { Session } from "@/lib/schemas/mcq";
import type {
  ClientModule,
  EngineerModuleRow,
  FinalOutput,
  Milestone,
  OutputConsistencyReport,
} from "@/lib/schemas/output";
import { canonicalModuleKey } from "@/lib/scoring/module-name";
import { logger } from "@/lib/logger";

/** Unresolved hard-constraint contradictions cannot retain a high score. */
const HARD_CONSTRAINT_CAP = 65;

/**
 * Reconcile independently generated views against the extraction and each
 * other. Repairs are deterministic and spend no model calls. Hard constraints
 * that cannot be repaired remain visible and cap confidence.
 */
export function reconcileOutput(session: Session, output: FinalOutput): FinalOutput {
  const extraction = session.rounds.at(-1)?.extraction;
  if (!extraction) return output;

  const issues: OutputConsistencyReport["issues"] = [];
  const clientModules = mergeClientModules(
    output.client.modules,
    extraction.modules,
    issues,
  );
  const engineerModules = mergeEngineerModules(
    output.engineer.module_table,
    extraction.modules,
    issues,
  );
  const buildOrder = completeBuildOrder(
    output.engineer.build_order,
    engineerModules,
    issues,
  );
  const milestones = milestonesFromPlan(output.engineer.sprint_breakdown);

  if (!sameMilestones(output.client.milestones, milestones)) {
    issues.push({
      code: "CROSS_VIEW_TIMELINE_REPAIRED",
      severity: "repaired",
      message:
        "Client milestones were aligned with the computed engineering sprint plan.",
    });
  }

  const requestedWeeks = requestedTimelineWeeks(session);
  const estimatedWeeks = output.engineer.effort_summary.total_sprints * 2;
  const timelineConflict =
    requestedWeeks !== null &&
    estimatedWeeks > requestedWeeks + Math.max(2, requestedWeeks * 0.1);
  if (timelineConflict) {
    issues.push({
      code: "TIMELINE_CONSTRAINT_CONFLICT",
      severity: "blocking",
      message: `The stated ${requestedWeeks}-week target is shorter than the computed ${estimatedWeeks}-week plan.`,
    });
  }

  const confidence = output.client.confidence_badge;
  const client = {
    ...output.client,
    modules: clientModules,
    milestones,
    open_items: timelineConflict
      ? appendUnique(
          output.client.open_items,
          `Resolve the timeline: the stated target is ${requestedWeeks} weeks, while the computed plan needs ${estimatedWeeks} weeks.`,
        )
      : output.client.open_items,
    confidence_badge: timelineConflict
      ? {
          ...confidence,
          score: Math.min(confidence.score, HARD_CONSTRAINT_CAP),
          breakdown: {
            ...confidence.breakdown,
            cap_applied: Math.min(confidence.breakdown.cap_applied, HARD_CONSTRAINT_CAP),
          },
        }
      : confidence,
  };

  const engineer = {
    ...output.engineer,
    module_table: engineerModules,
    build_order: buildOrder,
    risks: timelineConflict
      ? appendTimelineRisk(output.engineer.risks, requestedWeeks!, estimatedWeeks)
      : output.engineer.risks,
  };
  const report: OutputConsistencyReport = {
    consistent: !issues.some((issue) => issue.severity === "blocking"),
    checked_at: Date.now(),
    issues,
  };

  logger.info("output.consistency.checked", {
    sessionId: session.id,
    consistent: report.consistent,
    repairs: issues.filter((issue) => issue.severity === "repaired").length,
    blocking: issues.filter((issue) => issue.severity === "blocking").length,
    requestedWeeks,
    estimatedWeeks,
  });
  return { client, engineer, consistency_report: report };
}

/** A manual edit invalidates the generated cross-view check until regeneration. */
export function markOutputManuallyEdited(output: FinalOutput): FinalOutput {
  return {
    ...output,
    consistency_report: {
      consistent: false,
      checked_at: Date.now(),
      issues: [
        {
          code: "MANUAL_EDIT_REVIEW_REQUIRED",
          severity: "warning",
          message:
            "This version contains manual edits. Review both views together before approval.",
        },
      ],
    },
  };
}

function mergeClientModules(
  written: ClientModule[],
  source: Session["rounds"][number]["extraction"]["modules"],
  issues: OutputConsistencyReport["issues"],
): ClientModule[] {
  const byKey = new Map(
    written.map((module) => [canonicalModuleKey(module.name), module]),
  );
  return source.map((module) => {
    const existing = byKey.get(canonicalModuleKey(module.name));
    if (!existing) {
      issues.push({
        code: "CLIENT_MODULE_RESTORED",
        severity: "repaired",
        message: `Restored ${module.name} to the client view from the validated extraction.`,
      });
    }
    return {
      ...existing,
      name: module.name,
      description: existing?.description ?? module.description,
      size: module.size,
      github_validated: module.github_validated,
      confidence: module.module_confidence,
      seen_in: module.seen_in,
    };
  });
}

function mergeEngineerModules(
  written: EngineerModuleRow[],
  source: Session["rounds"][number]["extraction"]["modules"],
  issues: OutputConsistencyReport["issues"],
): EngineerModuleRow[] {
  const byKey = new Map(
    written.map((module) => [canonicalModuleKey(module.name), module]),
  );
  return source.map((module) => {
    const existing = byKey.get(canonicalModuleKey(module.name));
    if (!existing) {
      issues.push({
        code: "ENGINEER_MODULE_RESTORED",
        severity: "repaired",
        message: `Restored ${module.name} to the engineering view from the validated extraction.`,
      });
    }
    return {
      name: module.name,
      confidence: module.module_confidence,
      tech_stack: existing?.tech_stack ?? ["To be confirmed"],
      size: module.size,
      dependencies: existing?.dependencies ?? [],
      api_endpoints: existing?.api_endpoints ?? [],
      notes: existing?.notes ?? module.description,
      ...(existing?.id ? { id: existing.id } : {}),
    };
  });
}

function completeBuildOrder(
  written: string[],
  modules: EngineerModuleRow[],
  issues: OutputConsistencyReport["issues"],
): string[] {
  const names = new Map(
    modules.map((module) => [canonicalModuleKey(module.name), module.name]),
  );
  const seen = new Set<string>();
  const valid = written.flatMap((name) => {
    const key = canonicalModuleKey(name);
    const canonical = names.get(key);
    if (!canonical || seen.has(key)) return [];
    seen.add(key);
    return [canonical];
  });
  for (const [key, name] of names) {
    if (!seen.has(key)) valid.push(name);
  }
  if (
    valid.length !== written.length ||
    valid.some((name, index) => name !== written[index])
  ) {
    issues.push({
      code: "BUILD_ORDER_REPAIRED",
      severity: "repaired",
      message:
        "Build order was normalized to contain every validated module exactly once.",
    });
  }
  return valid;
}

function milestonesFromPlan(
  plan: FinalOutput["engineer"]["sprint_breakdown"],
): Milestone[] {
  if (plan.length <= 8) {
    return plan.map((sprint) => ({
      phase: sprint.sprint,
      name: sprint.focus.slice(0, 120),
      deliverables: (sprint.modules.length > 0 ? sprint.modules : [sprint.focus]).slice(
        0,
        12,
      ),
    }));
  }
  const groupSize = Math.ceil(plan.length / 8);
  const grouped: Milestone[] = [];
  for (let start = 0; start < plan.length; start += groupSize) {
    const group = plan.slice(start, start + groupSize);
    const modules = [...new Set(group.flatMap((sprint) => sprint.modules))];
    grouped.push({
      phase: `${group[0]!.sprint}–${group.at(-1)!.sprint}`.slice(0, 40),
      name: group
        .map((sprint) => sprint.focus)
        .join("; ")
        .slice(0, 120),
      deliverables: (modules.length > 0 ? modules : [group[0]!.focus]).slice(0, 12),
    });
  }
  return grouped;
}

function sameMilestones(a: Milestone[], b: Milestone[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function requestedTimelineWeeks(session: Session): number | null {
  const evidence = session.rounds
    .at(-1)
    ?.extraction.parameters.find(
      (parameter) => parameter.id === "P-08" && parameter.state === "PRESENT",
    )?.evidence;
  if (!evidence) return null;
  const values = [...evidence.matchAll(/(\d+(?:\.\d+)?)\s*(weeks?|months?)/gi)].map(
    (match) => Number(match[1]) * (match[2]!.toLowerCase().startsWith("month") ? 4 : 1),
  );
  return values.length > 0 ? Math.round(Math.max(...values)) : null;
}

function appendUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value].slice(0, 40);
}

function appendTimelineRisk(
  risks: FinalOutput["engineer"]["risks"],
  requestedWeeks: number,
  estimatedWeeks: number,
): FinalOutput["engineer"]["risks"] {
  if (risks.some((risk) => risk.rule_id === "timeline-constraint")) return risks;
  return [
    ...risks,
    {
      severity: "WARNING" as const,
      rule_id: "timeline-constraint",
      description: `The ${requestedWeeks}-week target conflicts with the computed ${estimatedWeeks}-week delivery plan. Reduce scope, add capacity, or move the deadline.`,
    },
  ].slice(0, 40);
}
