import { describe, expect, it } from "vitest";
import {
  githubFreqFor,
  moduleLevel,
  paramSignalFor,
  scoreModule,
  scoreModules,
  templateMatchFor,
} from "@/lib/scoring/modules";
import { SCOPING } from "@/lib/config/scoping";
import type { ModuleCandidate } from "@/lib/schemas/extraction";
import {
  makeEnrichment,
  makeExtraction,
  makeMatch,
  makeParameters,
} from "../fixtures/llm";

/** Blueprint step 07: per-module confidence. */

function mod(name: string): ModuleCandidate {
  return {
    name,
    description: `${name} module`,
    size: "SMALL",
    source_signal: "Mentioned in brief",
    github_validated: false,
    module_confidence: null,
    seen_in: [],
  };
}

const saas = (evidence?: string) =>
  makeExtraction({
    domain: "SaaS",
    parameters: makeParameters().map((p) =>
      p.id === "P-03"
        ? { ...p, state: "PARTIAL_THIN", evidence: evidence ?? p.evidence }
        : p,
    ),
  });

describe("paramSignal", () => {
  it("takes the strongest parameter whose evidence names the module", () => {
    const extraction = makeExtraction({
      parameters: makeParameters().map((p) =>
        p.id === "P-01"
          ? {
              ...p,
              state: "PRESENT",
              evidence: "Staff sign in through the Billing portal",
            }
          : p,
      ),
    });
    // P-01 is PRESENT (multiplier 1) and names Billing.
    expect(paramSignalFor(extraction, "Billing")).toBe(1);
  });

  it("falls back to P-03 when no evidence names the module", () => {
    const extraction = saas();
    expect(paramSignalFor(extraction, "Nothing Mentions This")).toBe(
      SCOPING.stateMultipliers.PARTIAL_THIN,
    );
  });

  it("matches plurals, so 'Notification' finds 'notifications'", () => {
    const extraction = makeExtraction({
      parameters: makeParameters().map((p) =>
        p.id === "P-01"
          ? { ...p, state: "PRESENT", evidence: "Email notifications go out nightly" }
          : p,
      ),
    });
    expect(paramSignalFor(extraction, "Notification")).toBe(1);
  });
});

describe("githubFreq", () => {
  it("is the share of matched repos that named it, weighted by similarity", () => {
    const enrichment = makeEnrichment([
      makeMatch({ repo: "a/one", similarity: 0.8, modules_found: ["Auth"] }),
      makeMatch({ repo: "b/two", similarity: 0.6, modules_found: ["Auth"] }),
      makeMatch({ repo: "c/three", similarity: 0.9, modules_found: ["Search"] }),
    ]);
    // 2 of 3 repos, average similarity 0.7 → 0.667 × 0.7.
    const { freq, seenIn } = githubFreqFor(enrichment, "Auth");
    expect(freq).toBeCloseTo((2 / 3) * 0.7, 5);
    expect(seenIn.map((r) => r.repo)).toEqual(["a/one", "b/two"]);
  });

  it("counts folder names too, and is 0 without matches", () => {
    const enrichment = makeEnrichment([
      makeMatch({ modules_found: [], folders_found: ["Billing"] }),
    ]);
    expect(githubFreqFor(enrichment, "Billing").freq).toBeCloseTo(0.7, 5);
    expect(githubFreqFor(null, "Billing").freq).toBe(0);
    expect(githubFreqFor(makeEnrichment([]), "Billing").freq).toBe(0);
  });
});

describe("templateMatch", () => {
  it.each([
    ["SaaS", "Billing", 1],
    ["SaaS", "Dashboard", 1],
    ["E-Commerce", "Checkout", 1],
    ["Marketplace", "Payouts", 1],
    ["Healthcare", "Appointments", 1],
    ["Internal Tool", "RBAC", 1],
    ["Content Platform", "Media Library", 1],
  ])("%s: %s is standard", (domain, module, expected) => {
    expect(templateMatchFor(domain, module)).toBe(expected);
  });

  it("gives half credit to a close synonym", () => {
    // "Sign-in" is a synonym of Auth, which is standard for SaaS.
    expect(templateMatchFor("SaaS", "Sign-in")).toBe(0.5);
    expect(templateMatchFor("SaaS", "Subscriptions")).toBe(0.5); // ~ Billing
  });

  it("gives nothing to a module the domain does not expect", () => {
    expect(templateMatchFor("SaaS", "Flight Booking")).toBe(0);
    expect(templateMatchFor("Unknown Domain", "Auth")).toBe(0);
  });
});

describe("the blend", () => {
  it("is 0.45 paramSignal + 0.35 githubFreq + 0.20 templateMatch", () => {
    expect(SCOPING.moduleWeights).toEqual({
      paramSignal: 0.45,
      githubFreq: 0.35,
      templateMatch: 0.2,
    });

    const extraction = makeExtraction({
      domain: "SaaS",
      parameters: makeParameters().map((p) =>
        p.id === "P-03"
          ? { ...p, state: "PRESENT", evidence: "Billing and invoices" }
          : p,
      ),
    });
    const enrichment = makeEnrichment([
      makeMatch({
        repo: "a/one",
        similarity: 0.8,
        modules_found: ["Billing"],
        folders_found: [],
      }),
      makeMatch({ repo: "b/two", similarity: 0.4, modules_found: [], folders_found: [] }),
    ]);

    const scored = scoreModule(extraction, enrichment, mod("Billing"));
    // paramSignal 1 · githubFreq 0.5 × 0.8 = 0.4 · templateMatch 1
    expect(scored).toMatchObject({ paramSignal: 1, templateMatch: 1 });
    expect(scored.githubFreq).toBeCloseTo(0.4, 5);
    expect(scored.confidence).toBeCloseTo(0.45 + 0.35 * 0.4 + 0.2, 4);
  });

  it("never leaves the 0-1 range", () => {
    const extraction = makeExtraction({ domain: "SaaS" });
    const best = scoreModule(extraction, makeEnrichment(), mod("Auth")).confidence;
    const worst = scoreModule(
      makeExtraction({
        domain: "Unknown",
        parameters: makeParameters({ "P-03": "MISSING" }),
      }),
      null,
      mod("Flight Booking"),
    ).confidence;
    expect(best).toBeLessThanOrEqual(1);
    expect(worst).toBe(0);
  });

  it("scores every module and records where it was seen", () => {
    const extraction = makeExtraction({ domain: "SaaS", modules: [mod("Auth")] });
    const scored = scoreModules(extraction, makeEnrichment());
    expect(scored.modules[0]!.module_confidence).toBeGreaterThan(0);
    expect(scored.modules[0]!.seen_in).toEqual([
      { repo: "acme/shop-core", url: "https://github.com/acme/shop-core" },
    ]);
  });

  it("gives the same answer every time", () => {
    const extraction = makeExtraction({ domain: "SaaS" });
    const runs = Array.from(
      { length: 10 },
      () => scoreModule(extraction, makeEnrichment(), mod("Auth")).confidence,
    );
    expect(new Set(runs).size).toBe(1);
  });
});

describe("levels", () => {
  it.each([
    [1, "HIGH"],
    [0.81, "HIGH"],
    [0.8, "MEDIUM"], // 0.80 exactly is not "above 0.80"
    [0.55, "MEDIUM"],
    [0.549, "LOW"],
    [0, "LOW"],
  ])("%d is %s", (confidence, level) => {
    expect(moduleLevel(confidence)).toBe(level);
  });

  it("treats an unscored module as MEDIUM rather than a candidate", () => {
    expect(moduleLevel(null)).toBe("MEDIUM");
  });

  it("uses the configured thresholds", () => {
    expect(SCOPING.moduleHigh).toBe(0.8);
    expect(SCOPING.moduleLow).toBe(0.55);
  });
});
