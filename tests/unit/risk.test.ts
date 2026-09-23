import { describe, expect, it } from "vitest";
import { detectRisks, type RiskRuleId } from "@/lib/scoring/risk";
import { SCOPING } from "@/lib/config/scoping";
import type { ExtractionResult, ModuleCandidate } from "@/lib/schemas/extraction";
import { makeExtraction, makeParameters } from "../fixtures/llm";

/** Blueprint step 09: the risk engine. Every rule, firing and not firing. */

function mod(name: string, description = `${name} module`): ModuleCandidate {
  return {
    name,
    description,
    size: "MEDIUM",
    source_signal: "Mentioned in brief",
    github_validated: false,
    module_confidence: null,
    seen_in: [],
  };
}

/**
 * An extraction with nothing that trips a rule: a plain e-commerce scope,
 * P-05 answered, one platform, three modules.
 */
function quiet(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return makeExtraction({
    domain: "E-Commerce",
    modules: [mod("Catalog"), mod("Orders"), mod("Admin Panel")],
    parameters: makeParameters().map((p) =>
      p.id === "P-05"
        ? { ...p, state: "PRESENT", evidence: "Razorpay for cards" }
        : { ...p, evidence: "A shop that sells shoes online" },
    ),
    ...overrides,
  });
}

const ids = (extraction: ExtractionResult): RiskRuleId[] =>
  detectRisks(extraction).map((r) => r.rule_id);

describe("a scope with no risk signals", () => {
  it("produces no risks at all", () => {
    expect(detectRisks(quiet())).toEqual([]);
  });
});

describe("scope explosion", () => {
  it("fires past the configured module count", () => {
    const modules = Array.from({ length: SCOPING.scopeExplosionModules + 1 }, (_, i) =>
      mod(`Module ${i}`),
    );
    const risks = detectRisks(quiet({ modules }));
    expect(risks.map((r) => r.rule_id)).toContain("scope-explosion");
    expect(risks.find((r) => r.rule_id === "scope-explosion")).toMatchObject({
      severity: "WARNING",
    });
    expect(risks.find((r) => r.rule_id === "scope-explosion")?.description).toContain(
      `${SCOPING.scopeExplosionModules + 1} modules`,
    );
  });

  it("does not fire at exactly the threshold", () => {
    const modules = Array.from({ length: SCOPING.scopeExplosionModules }, (_, i) =>
      mod(`Module ${i}`),
    );
    expect(ids(quiet({ modules }))).not.toContain("scope-explosion");
  });
});

describe("real-time infrastructure", () => {
  it.each([
    ["Chat", "Buyers and sellers chat before agreeing"],
    ["Tracking", "Live tracking of the driver on a map"],
    ["Feed", "Updates stream over a websocket"],
    ["Video", "Streaming lessons to students"],
  ])("fires on %s", (name, description) => {
    const risks = detectRisks(quiet({ modules: [mod(name, description)] }));
    expect(risks.map((r) => r.rule_id)).toContain("realtime-infra");
    expect(risks.find((r) => r.rule_id === "realtime-infra")?.severity).toBe("WARNING");
  });

  it("does not fire on a scope that only polls", () => {
    expect(
      ids(quiet({ modules: [mod("Orders", "The page refreshes every minute")] })),
    ).not.toContain("realtime-infra");
  });

  it("reads the parameter evidence too, not only module names", () => {
    const extraction = quiet({
      parameters: makeParameters().map((p) =>
        p.id === "P-03"
          ? { ...p, evidence: "Dispatchers watch deliveries in real-time" }
          : p,
      ),
    });
    expect(ids(extraction)).toContain("realtime-infra");
  });
});

describe("integrations mentioned but unspecified", () => {
  const withP05Missing = (modules: ModuleCandidate[]) =>
    quiet({
      modules,
      parameters: makeParameters({ "P-05": "MISSING" }),
    });

  it("is CRITICAL when payments are in scope with no provider", () => {
    const risks = detectRisks(
      withP05Missing([mod("Checkout", "Card payment at checkout")]),
    );
    const risk = risks.find((r) => r.rule_id === "integrations-unspecified");
    expect(risk?.severity).toBe("CRITICAL");
    expect(risk?.description).toContain("P-05 is MISSING");
  });

  it("is a WARNING when only notifications are in scope", () => {
    const risks = detectRisks(withP05Missing([mod("Reminders", "Send an SMS reminder")]));
    expect(risks.find((r) => r.rule_id === "integrations-unspecified")?.severity).toBe(
      "WARNING",
    );
  });

  it("does not fire when the integrations parameter is answered", () => {
    // Same modules, but P-05 is PRESENT in `quiet`.
    expect(
      ids(quiet({ modules: [mod("Checkout", "Card payment at checkout")] })),
    ).not.toContain("integrations-unspecified");
  });

  it("does not fire when nothing needs a provider", () => {
    expect(
      ids(withP05Missing([mod("Catalog", "Browse products by category")])),
    ).not.toContain("integrations-unspecified");
  });
});

describe("web and mobile at once", () => {
  it("fires when a native app and a web build are both in scope", () => {
    const extraction = quiet({
      modules: [
        mod("Driver App", "Android app for drivers"),
        mod("Dispatch Board", "Web app for dispatchers"),
      ],
    });
    const risks = detectRisks(extraction);
    expect(risks.map((r) => r.rule_id)).toContain("multi-platform");
    expect(risks.find((r) => r.rule_id === "multi-platform")?.severity).toBe("WARNING");
  });

  it("does not fire on a responsive web app", () => {
    // "Works well on phones" is one build, not two.
    const extraction = quiet({
      modules: [mod("Storefront", "A web app that works well on mobile phones")],
    });
    expect(ids(extraction)).not.toContain("multi-platform");
  });

  it("does not fire on a mobile-only scope", () => {
    expect(
      ids(quiet({ modules: [mod("App", "Android app with offline sync")] })),
    ).not.toContain("multi-platform");
  });

  it("does not read React Native as a web signal", () => {
    expect(
      ids(quiet({ modules: [mod("App", "React Native app for both stores")] })),
    ).not.toContain("multi-platform");
  });
});

describe("domain compliance", () => {
  it.each([
    ["FinTech", "KYC"],
    ["Healthcare", "HIPAA"],
  ])("always warns for %s", (domain, mention) => {
    const risks = detectRisks(quiet({ domain }));
    const risk = risks.find((r) => r.rule_id === "domain-compliance");
    expect(risk?.severity).toBe("WARNING");
    expect(risk?.description).toContain(mention);
  });

  it("warns even when the compliance parameter is already answered", () => {
    const extraction = quiet({
      domain: "FinTech",
      parameters: makeParameters().map((p) =>
        p.id === "P-06" ? { ...p, state: "PRESENT", evidence: "RBI rules apply" } : p,
      ),
    });
    expect(ids(extraction)).toContain("domain-compliance");
  });

  it.each(["SaaS", "E-Commerce", "Marketplace", "EdTech", "Internal Tool"])(
    "does not warn for %s",
    (domain) => {
      expect(ids(quiet({ domain }))).not.toContain("domain-compliance");
    },
  );
});

describe("the list itself", () => {
  it("puts the most severe first", () => {
    const extraction = quiet({
      domain: "FinTech",
      modules: [
        mod("Payments", "Card payment at checkout"),
        mod("Chat", "Support chat with an agent"),
      ],
      parameters: makeParameters({ "P-05": "MISSING" }),
    });
    const risks = detectRisks(extraction);
    expect(risks[0]?.severity).toBe("CRITICAL");
    expect(risks.map((r) => r.rule_id)).toEqual([
      "integrations-unspecified",
      "realtime-infra",
      "domain-compliance",
    ]);
  });

  it("gives the same answer every time", () => {
    const extraction = quiet({ domain: "Healthcare" });
    const runs = Array.from({ length: 10 }, () =>
      JSON.stringify(detectRisks(extraction)),
    );
    expect(new Set(runs).size).toBe(1);
  });
});
