import { describe, expect, it } from "vitest";
import {
  bandFor,
  bandWithLabel,
  clampTeam,
  complexityFor,
  estimateEffort,
  planSprints,
  pointsFor,
  teamSizeFrom,
  teamSizeIn,
  velocityFor,
  type EffortModule,
} from "@/lib/scoring/effort";
import { SCOPING } from "@/lib/config/scoping";
import type { ModuleSize } from "@/lib/schemas/extraction";

/** Blueprint step 10: the effort engine. */

const mod = (name: string, size: ModuleSize) => ({ name, size });

describe("the table", () => {
  it.each([
    ["SMALL", 8],
    ["MEDIUM", 21],
    ["LARGE", 40],
  ])("%s is worth %i points", (size, points) => {
    expect(pointsFor(size as ModuleSize)).toBe(points);
  });

  it.each([
    ["FinTech", 1.4],
    ["Healthcare", 1.35],
    ["Marketplace", 1.25],
    ["SaaS", 1.1],
    ["Internal Tool", 0.85],
    ["E-Commerce", 1],
    ["Content Platform", 1],
    ["Something Else Entirely", 1],
  ])("%s multiplies by %f", (domain, multiplier) => {
    expect(complexityFor(domain)).toBe(multiplier);
  });

  it.each([
    [1, 13],
    [2, 26],
    [3, 26],
    [4, 45],
    [6, 45],
    [7, 60],
    [10, 60],
  ])("a team of %i delivers %i points a sprint", (team, velocity) => {
    expect(velocityFor(team)).toBe(velocity);
  });

  it("keeps the last band for a team larger than the table", () => {
    // More people on one scope stops adding points; it does not go backwards.
    expect(velocityFor(20)).toBe(60);
    expect(velocityFor(SCOPING.maxTeamSize)).toBe(60);
  });

  it("clamps a team size instead of rejecting it", () => {
    expect(clampTeam(0)).toBe(1);
    expect(clampTeam(-4)).toBe(1);
    expect(clampTeam(2.4)).toBe(2);
    expect(clampTeam(900)).toBe(SCOPING.maxTeamSize);
    expect(clampTeam(Number.NaN)).toBe(SCOPING.defaultTeamSize);
  });
});

describe("fixed module sets give fixed sprint counts", () => {
  it.each([
    // modules, domain, team → points, sprints
    [[mod("Auth", "MEDIUM")], "SaaS", 3, 23, 1],
    [
      [mod("Auth", "MEDIUM"), mod("Billing", "LARGE"), mod("Settings", "SMALL")],
      "SaaS",
      3,
      // 21×1.1=23, 40×1.1=44, 8×1.1=9 → 76 at velocity 26
      76,
      3,
    ],
    [
      [mod("Auth", "MEDIUM"), mod("Billing", "LARGE"), mod("Settings", "SMALL")],
      "SaaS",
      1,
      76,
      6,
    ],
    [
      [mod("KYC", "LARGE"), mod("Ledger", "LARGE"), mod("Payments", "LARGE")],
      "FinTech",
      // 40×1.4 = 56 each → 168 at velocity 45
      5,
      168,
      4,
    ],
    [
      [mod("RBAC", "MEDIUM"), mod("Audit Log", "SMALL")],
      "Internal Tool",
      // 21×0.85=18, 8×0.85=7 → 25 at velocity 26
      2,
      25,
      1,
    ],
    [
      [mod("Appointments", "LARGE"), mod("Records", "MEDIUM")],
      "Healthcare",
      // 54 + 28 = 82 at velocity 60
      8,
      82,
      2,
    ],
  ])("%#: %s sprints", (modules, domain, teamSize, expectedPoints, expectedSprints) => {
    const estimate = estimateEffort({
      modules: modules as ReturnType<typeof mod>[],
      domain: domain as string,
      confidence: 85,
      teamSize: teamSize as number,
    });
    expect(estimate.totalPoints).toBe(expectedPoints);
    expect(estimate.sprints).toBe(expectedSprints);
  });

  it("is at least one sprint even with nothing to build", () => {
    const estimate = estimateEffort({ modules: [], domain: "SaaS", confidence: 90 });
    expect(estimate.totalPoints).toBe(0);
    expect(estimate.sprints).toBe(1);
    expect(estimate.plan).toHaveLength(1);
  });

  it("defaults the team to the configured size when nobody said one", () => {
    const estimate = estimateEffort({
      modules: [mod("Auth", "MEDIUM")],
      domain: "SaaS",
      confidence: 90,
    });
    expect(estimate.teamSize).toBe(SCOPING.defaultTeamSize);
    expect(estimate.teamSizeStated).toBe(false);
  });

  it("gives the same answer every time", () => {
    const input = {
      modules: [mod("Auth", "MEDIUM"), mod("Search", "SMALL")],
      domain: "Marketplace",
      confidence: 72,
      teamSize: 4,
    };
    const runs = Array.from({ length: 10 }, () => estimateEffort(input).sprints);
    expect(new Set(runs).size).toBe(1);
  });

  it("lists every module's points so the panel adds up", () => {
    const estimate = estimateEffort({
      modules: [mod("Auth", "MEDIUM"), mod("Payouts", "LARGE")],
      domain: "Marketplace",
      confidence: 80,
    });
    expect(estimate.modules).toEqual([
      { name: "Auth", size: "MEDIUM", basePoints: 21, points: 26 },
      { name: "Payouts", size: "LARGE", basePoints: 40, points: 50 },
    ]);
    expect(estimate.totalPoints).toBe(76);
  });
});

describe("the confidence band", () => {
  it.each([
    [100, "±20%"],
    [80, "±20%"],
    [79, "±35%"],
    [60, "±35%"],
    [59, "unreliable — clarify first"],
    [0, "unreliable — clarify first"],
  ])("a score of %i gives %s", (score, label) => {
    expect(bandFor(score, 10).label).toBe(label);
  });

  it("turns the percentage into a sprint range", () => {
    expect(bandFor(85, 10)).toMatchObject({ lowSprints: 8, highSprints: 12 });
    expect(bandFor(65, 10)).toMatchObject({ lowSprints: 6, highSprints: 14 });
  });

  it("gives no range at all below 60", () => {
    const band = bandFor(40, 10);
    expect(band.reliable).toBe(false);
    expect(band).toMatchObject({ lowSprints: 10, highSprints: 10, percent: null });
  });

  it("never offers a range below one sprint", () => {
    expect(bandFor(90, 1).lowSprints).toBe(1);
  });

  it("re-attaches a stored label to a new sprint count", () => {
    expect(bandWithLabel("±20%", 20)).toMatchObject({
      lowSprints: 16,
      highSprints: 24,
      reliable: true,
    });
    // A document written before the engine existed.
    expect(bandWithLabel("±20% (high confidence)", 20).reliable).toBe(false);
  });
});

describe("the sprint plan", () => {
  const modules: EffortModule[] = [
    { name: "Auth", size: "MEDIUM", basePoints: 21, points: 21 },
    { name: "Billing", size: "LARGE", basePoints: 40, points: 40 },
    { name: "Settings", size: "SMALL", basePoints: 8, points: 8 },
  ];

  it("has exactly as many rows as the sprint count", () => {
    const plan = planSprints(modules, 26, 3);
    expect(plan).toHaveLength(3);
    expect(plan.map((p) => p.sprint)).toEqual(["Sprint 1", "Sprint 2", "Sprint 3"]);
  });

  it("fills each sprint to the velocity and spends every point", () => {
    const plan = planSprints(modules, 26, 3);
    expect(plan.map((p) => p.storyPoints)).toEqual([26, 26, 17]);
    expect(plan.reduce((sum, p) => sum + p.storyPoints, 0)).toBe(69);
  });

  it("carries a module that does not fit into the next sprint", () => {
    // Billing is 40 points against a solo velocity of 13.
    const plan = planSprints([modules[1]!], 13, 4);
    expect(plan.map((p) => p.modules)).toEqual([
      ["Billing"],
      ["Billing"],
      ["Billing"],
      ["Billing"],
    ]);
    expect(plan.map((p) => p.storyPoints)).toEqual([13, 13, 13, 1]);
  });

  it("leaves a trailing sprint empty rather than inventing work", () => {
    const plan = planSprints([modules[2]!], 26, 2);
    expect(plan[1]).toEqual({ sprint: "Sprint 2", modules: [], storyPoints: 0 });
  });

  it("folds a long plan into the rows the schema stores", () => {
    const many: EffortModule[] = Array.from({ length: 30 }, (_, i) => ({
      name: `M${i}`,
      size: "LARGE" as const,
      basePoints: 40,
      points: 40,
    }));
    const plan = planSprints(many, 13, 93);
    expect(plan).toHaveLength(SCOPING.maxSprintRows);
    expect(plan[plan.length - 1]!.sprint).toBe(`Sprints ${SCOPING.maxSprintRows}-93`);
    expect(plan.reduce((sum, p) => sum + p.storyPoints, 0)).toBe(30 * 40);
  });
});

describe("team size, read from what the client wrote", () => {
  it.each([
    ["We are a team of 4 developers.", 4],
    ["Team of two on our side.", 2],
    ["A two-person team, mobile-first.", 2],
    ["We have 6 engineers in-house.", 6],
    ["Four people on our side will be involved.", 4],
    ["I am building this solo.", 1],
    ["It's just me for now.", 1],
    ["we are 3 and we move fast", 3],
  ])("reads %j as %i", (text, size) => {
    expect(teamSizeIn(text)).toBe(size);
  });

  it.each([
    "An Android app for our 200 delivery drivers.",
    "Around 5,000 students use it every term.",
    "Two physios and a receptionist use it daily.",
    "We handle 12,000 orders a day.",
    "",
  ])("does not read a user count as a team size: %j", (text) => {
    expect(teamSizeIn(text)).toBeNull();
  });

  it("clamps an absurd number", () => {
    expect(teamSizeIn("We have 400 developers.")).toBe(SCOPING.maxTeamSize);
  });

  it("lets the newest statement win", () => {
    expect(
      teamSizeFrom(["We are a team of 2.", "Since then we hired: team of 5 now."]),
    ).toEqual({ size: 5, stated: true });
  });

  it("falls back to the default, and says that it did", () => {
    expect(teamSizeFrom(["A booking tool for my salon."])).toEqual({
      size: SCOPING.defaultTeamSize,
      stated: false,
    });
    expect(teamSizeFrom([])).toEqual({
      size: SCOPING.defaultTeamSize,
      stated: false,
    });
  });
});
