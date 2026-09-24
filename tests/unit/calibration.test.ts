import { describe, expect, it } from "vitest";
import {
  averageAbsoluteError,
  calibrationSentence,
  compareRecords,
  computeFactors,
  confidenceFor,
  errorTrend,
  estimatedModuleSprints,
  factorForSize,
  MIN_PROJECTS,
  summariseApplied,
  type ActualRecord,
  type Calibration,
} from "@/lib/calibration/factors";
import { estimateEffort } from "@/lib/scoring/effort";

/**
 * The calibration maths: what a workspace's finished projects say about its
 * estimates, and the rule that four of them say nothing yet.
 */

function record(overrides: Partial<ActualRecord> = {}): ActualRecord {
  return {
    projectId: overrides.projectId ?? crypto.randomUUID(),
    domain: "SaaS",
    actualWeeks: 12, // 6 sprints
    actualTeamSize: 3,
    scopeAccuracy: 3,
    modules: [],
    estimatedSprints: 6,
    estimatedPoints: 156,
    estimatedTeamSize: 3,
    estimatedVelocity: 26,
    domainMultiplier: 1,
    recordedAt: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  };
}

/** `count` projects in one domain, each taking `ratio` times its estimate. */
function project(count: number, ratio: number, domain = "SaaS"): ActualRecord[] {
  return Array.from({ length: count }, () =>
    record({ domain, actualWeeks: 10 * ratio, estimatedSprints: 5 }),
  );
}

describe("the ratio", () => {
  it("is what it took over what was estimated", () => {
    // 12 weeks = 6 sprints against 5 estimated.
    const factors = computeFactors([record({ actualWeeks: 12, estimatedSprints: 5 })]);
    expect(factors.overall?.ratio).toBe(1.2);
  });

  it("is 1 when the estimate was right", () => {
    expect(computeFactors([record()]).overall?.ratio).toBe(1);
  });

  it("is below 1 when a project came in early", () => {
    const factors = computeFactors([record({ actualWeeks: 8, estimatedSprints: 5 })]);
    expect(factors.overall?.ratio).toBe(0.8);
  });

  it("weighs a long project more than a short one", () => {
    // One 20-sprint project that doubled, one 1-sprint project that halved.
    const factors = computeFactors([
      record({ actualWeeks: 80, estimatedSprints: 20 }),
      record({ actualWeeks: 1, estimatedSprints: 1 }),
    ]);
    // Summed totals: (40 + 0.5) / 21 ≈ 1.93, not the mean of 2 and 0.5.
    expect(factors.overall?.ratio).toBeCloseTo(1.93, 1);
  });

  it("refuses to be moved past its bounds by one absurd record", () => {
    const factors = computeFactors([record({ actualWeeks: 260, estimatedSprints: 1 })]);
    expect(factors.overall?.ratio).toBe(4);
  });

  it("ignores a record with no estimate to compare against", () => {
    expect(computeFactors([record({ estimatedSprints: 0 })]).overall).toBeNull();
  });
});

describe("per domain and per size", () => {
  it("keeps domains apart", () => {
    const factors = computeFactors([
      ...project(5, 1.5, "FinTech"),
      ...project(5, 0.8, "Internal Tool"),
    ]);
    expect(factors.byDomain.fintech?.ratio).toBe(1.5);
    expect(factors.byDomain["internal-tools"]?.ratio).toBe(0.8);
  });

  it("measures a size against the sprints the estimate implied for it", () => {
    // A MEDIUM module is 21 points; at velocity 26 that is 0.81 sprints.
    const implied = estimatedModuleSprints("MEDIUM", {
      domainMultiplier: 1,
      estimatedVelocity: 26,
    });
    expect(implied).toBeCloseTo(0.81, 2);

    const factors = computeFactors([
      record({
        modules: [
          { estimatedSize: "MEDIUM", actualSize: "LARGE", actualSprints: implied * 2 },
        ],
      }),
    ]);
    expect(factors.bySize.MEDIUM?.ratio).toBe(2);
  });

  it("leaves a module out when its time could not be separated", () => {
    const factors = computeFactors([
      record({
        modules: [
          { estimatedSize: "SMALL", actualSize: "SMALL", actualSprints: 0 },
          { estimatedSize: "LARGE", actualSize: "LARGE", actualSprints: 3 },
        ],
      }),
    ]);
    expect(factors.bySize.SMALL).toBeUndefined();
    expect(factors.bySize.LARGE).toBeDefined();
  });

  it("counts projects, not modules", () => {
    const factors = computeFactors([
      record({
        projectId: "p1",
        modules: [
          { estimatedSize: "SMALL", actualSize: "SMALL", actualSprints: 1 },
          { estimatedSize: "SMALL", actualSize: "SMALL", actualSprints: 1 },
          { estimatedSize: "SMALL", actualSize: "SMALL", actualSprints: 1 },
        ],
      }),
    ]);
    expect(factors.bySize.SMALL?.projects).toBe(1);
  });
});

describe("the five-project rule", () => {
  it("does not offer a factor until five projects stand behind it", () => {
    for (let count = 1; count < MIN_PROJECTS; count += 1) {
      const factors = computeFactors(project(count, 1.4));
      expect(factors.byDomain.saas?.projects).toBe(count);
      expect(factors.byDomain.saas?.applicable).toBe(false);
      expect(factors.byDomain.saas?.confidence).toBe("none");
    }
  });

  it("offers it at exactly five", () => {
    const factors = computeFactors(project(MIN_PROJECTS, 1.4));
    expect(factors.byDomain.saas?.applicable).toBe(true);
    expect(factors.byDomain.saas?.confidence).toBe("low");
  });

  it("grows more confident with more projects", () => {
    expect(confidenceFor(4)).toBe("none");
    expect(confidenceFor(5)).toBe("low");
    expect(confidenceFor(10)).toBe("medium");
    expect(confidenceFor(20)).toBe("high");
  });

  it("is enforced again when a factor is handed to the engine by hand", () => {
    const underpowered: Calibration = {
      bySize: {
        MEDIUM: { ratio: 2, projects: 4, confidence: "none", applicable: true },
      },
      domain: null,
      source: "workspace",
    };
    expect(factorForSize(underpowered, "MEDIUM")).toBeNull();
  });

  it("falls back to the domain factor for a size with no history", () => {
    const calibration: Calibration = {
      bySize: {},
      domain: { ratio: 1.3, projects: 6, confidence: "low", applicable: true },
      source: "workspace",
    };
    expect(factorForSize(calibration, "LARGE")?.ratio).toBe(1.3);
  });
});

describe("what the estimate does with it", () => {
  const modules = [
    { name: "Auth", size: "MEDIUM" as const },
    { name: "Billing", size: "LARGE" as const },
  ];

  it("is unchanged when there is no calibration", () => {
    const plain = estimateEffort({ modules, domain: "SaaS", confidence: 80 });
    expect(plain.calibration).toBeNull();
    expect(plain.totalPoints).toBe(Math.round(21 * 1.1) + Math.round(40 * 1.1));
  });

  it("applies a factor and reports what it did", () => {
    const calibration: Calibration = {
      bySize: {},
      domain: { ratio: 1.2, projects: 7, confidence: "low", applicable: true },
      source: "workspace",
    };
    const plain = estimateEffort({ modules, domain: "SaaS", confidence: 80 });
    const adjusted = estimateEffort({
      modules,
      domain: "SaaS",
      confidence: 80,
      calibration,
    });

    expect(adjusted.totalPoints).toBeGreaterThan(plain.totalPoints);
    // The multiplier is measured on the points as rounded, so it is the
    // ratio the document can actually be checked against, not the input.
    expect(adjusted.calibration?.multiplier).toBeCloseTo(1.2, 1);
    expect(adjusted.calibration).toMatchObject({ projects: 7, source: "workspace" });
    expect(adjusted.sprints).toBeGreaterThanOrEqual(plain.sprints);
  });

  it("ignores a factor that has not reached five projects", () => {
    const calibration: Calibration = {
      bySize: {},
      domain: { ratio: 1.8, projects: 4, confidence: "none", applicable: false },
      source: "workspace",
    };
    const plain = estimateEffort({ modules, domain: "SaaS", confidence: 80 });
    const same = estimateEffort({ modules, domain: "SaaS", confidence: 80, calibration });

    expect(same.totalPoints).toBe(plain.totalPoints);
    expect(same.calibration).toBeNull();
  });

  it("prefers the size factor over the domain's where it has one", () => {
    const calibration: Calibration = {
      bySize: {
        LARGE: { ratio: 2, projects: 8, confidence: "low", applicable: true },
      },
      domain: { ratio: 1.1, projects: 8, confidence: "low", applicable: true },
      source: "workspace",
    };
    const adjusted = estimateEffort({
      modules,
      domain: "SaaS",
      confidence: 80,
      calibration,
    });
    const medium = Math.round(21 * 1.1 * 1.1); // domain factor
    const large = Math.round(40 * 1.1 * 2); // size factor
    expect(adjusted.totalPoints).toBe(medium + large);
  });

  it("reports the weakest evidence behind the adjustment", () => {
    const applied = summariseApplied(
      { bySize: {}, domain: null, source: "workspace" },
      100,
      118,
      [
        { ratio: 1.2, projects: 12, confidence: "medium", applicable: true },
        { ratio: 1.1, projects: 7, confidence: "low", applicable: true },
      ],
    );
    expect(applied).toEqual({
      multiplier: 1.18,
      projects: 7,
      source: "workspace",
      confidence: "low",
    });
  });

  it("says nothing when the adjustment rounds to nothing", () => {
    expect(
      summariseApplied({ bySize: {}, domain: null, source: "workspace" }, 100, 100, [
        { ratio: 1, projects: 9, confidence: "low", applicable: true },
      ]),
    ).toBeNull();
  });
});

describe("the sentence the panel shows", () => {
  it("is the one the task asked for", () => {
    expect(
      calibrationSentence({
        multiplier: 1.18,
        projects: 7,
        source: "workspace",
        confidence: "low",
      }),
    ).toBe("Adjusted using 7 of your past projects: +18%");
  });

  it("says when the estimate came down", () => {
    expect(
      calibrationSentence({
        multiplier: 0.85,
        projects: 11,
        source: "workspace",
        confidence: "medium",
      }),
    ).toBe("Adjusted using 11 of your past projects: -15%");
  });

  it("names the shared pool when that is where it came from", () => {
    expect(
      calibrationSentence({
        multiplier: 1.1,
        projects: 30,
        source: "shared",
        confidence: "high",
      }),
    ).toBe("Adjusted using 30 shared projects: +10%");
  });
});

describe("estimate against actual, for the analytics page", () => {
  const records = [
    record({
      projectId: "p1",
      actualWeeks: 12,
      estimatedSprints: 5,
      recordedAt: new Date("2026-07-15T00:00:00Z"),
    }),
    record({
      projectId: "p2",
      actualWeeks: 8,
      estimatedSprints: 5,
      recordedAt: new Date("2026-08-15T00:00:00Z"),
    }),
    record({
      projectId: "p3",
      actualWeeks: 10,
      estimatedSprints: 5,
      recordedAt: new Date("2026-08-20T00:00:00Z"),
    }),
  ];

  it("reports each project's error as a percentage", () => {
    const comparisons = compareRecords(records);
    expect(comparisons[0]).toMatchObject({
      projectId: "p1",
      actualSprints: 6,
      estimatedSprints: 5,
      errorPercent: 20,
    });
    expect(comparisons[1]?.errorPercent).toBe(20); // 4 sprints against 5
    expect(comparisons[2]?.errorPercent).toBe(0);
  });

  it("puts them oldest first", () => {
    expect(compareRecords(records).map((c) => c.projectId)).toEqual(["p1", "p2", "p3"]);
  });

  it("averages the absolute error", () => {
    expect(averageAbsoluteError(compareRecords(records))).toBe(13);
    expect(averageAbsoluteError([])).toBe(0);
  });

  it("groups the trend by the month it was recorded", () => {
    expect(errorTrend(compareRecords(records))).toEqual([
      { month: "2026-07", projects: 1, averageErrorPercent: 20 },
      { month: "2026-08", projects: 2, averageErrorPercent: 10 },
    ]);
  });
});
