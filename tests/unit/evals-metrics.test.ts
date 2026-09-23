import { describe, expect, it } from "vitest";
import {
  allAgree,
  domainFamily,
  domainMatches,
  estimateCost,
  leakedStrings,
  mean,
  moduleRecall,
  percentile,
  rate,
  sameModule,
  stateDistance,
  stdev,
} from "@/evals/lib/metrics";

/** The maths the evaluation report prints (evals/run.ts). */

describe("parameter states", () => {
  it("measures the distance along MISSING → PARTIAL_THIN → PARTIAL_DEEP → PRESENT", () => {
    expect(stateDistance("PRESENT", "PRESENT")).toBe(0);
    expect(stateDistance("PRESENT", "PARTIAL_DEEP")).toBe(1);
    expect(stateDistance("PRESENT", "PARTIAL_THIN")).toBe(2);
    expect(stateDistance("PRESENT", "MISSING")).toBe(3);
    expect(stateDistance("MISSING", "PARTIAL_THIN")).toBe(1);
  });

  it("returns null for anything that is not a state", () => {
    expect(stateDistance("PRESENT", "")).toBeNull();
    expect(stateDistance("present", "PRESENT")).toBeNull();
  });
});

describe("domains", () => {
  it.each([
    ["SaaS", "saas"],
    ["B2B SaaS analytics platform", "saas"],
    ["E-Commerce", "ecommerce"],
    ["eCommerce store", "ecommerce"],
    ["Retail", "ecommerce"],
    ["Marketplace", "marketplace"],
    ["Two-sided marketplace for services", "marketplace"],
    ["FinTech", "fintech"],
    ["Lending", "fintech"],
    ["EdTech", "edtech"],
    ["Online learning", "edtech"],
    ["Healthcare", "healthcare"],
    ["Telehealth / patient portal", "healthcare"],
    ["Internal Tool", "internal-tools"],
    ["Logistics operations", "internal-tools"],
    ["Content Platform", "cms"],
    ["Publishing / news", "cms"],
    ["Mobile", "mobile"],
    ["Android app", "mobile"],
  ])("puts %j in the %s family", (label, family) => {
    expect(domainFamily(label)).toBe(family);
  });

  it("prefers the specific family when a label names two", () => {
    // A marketplace on mobile is still a marketplace.
    expect(domainFamily("Mobile marketplace")).toBe("marketplace");
    expect(domainFamily("Healthcare SaaS platform")).toBe("healthcare");
  });

  it("has no family for a label that means nothing to us", () => {
    expect(domainFamily("Small Business")).toBeNull();
    expect(domainFamily("")).toBeNull();
  });

  it("matches on the family, not on the words", () => {
    expect(domainMatches("SaaS", "B2B SaaS for agencies")).toBe(true);
    expect(domainMatches("E-Commerce", "Online Retail")).toBe(true);
    expect(domainMatches("SaaS", "Healthcare")).toBe(false);
    // An expected label we cannot place can never be scored as a match.
    expect(domainMatches("Small Business", "Small Business")).toBe(false);
  });
});

describe("module recall", () => {
  it("accepts a plural and a synonym", () => {
    expect(sameModule("Notifications", "Notification")).toBe(true);
    expect(sameModule("Appointments", "Bookings")).toBe(true);
    expect(sameModule("Auth", "Authentication")).toBe(true);
    expect(sameModule("Auth", "Catalog")).toBe(false);
  });

  it("is the share of labelled modules the extraction proposed", () => {
    const { recall, missing } = moduleRecall(
      ["Auth", "Billing", "Audit Log"],
      ["Sign-in", "Subscriptions", "Dashboard"],
    );
    // Auth ~ Sign-in and Billing ~ Subscriptions; Audit Log is absent.
    expect(recall).toBeCloseTo(2 / 3, 5);
    expect(missing).toEqual(["Audit Log"]);
  });

  it("is 1 when the case asks for nothing", () => {
    expect(moduleRecall([], ["Auth"]).recall).toBe(1);
  });
});

describe("injection payloads", () => {
  it("finds a forbidden string anywhere in the output, ignoring case", () => {
    const leaked = leakedStrings(
      ["PWNED-7731", "evil-corp"],
      '{"summary":"validated by pwned-7731","modules":[]}',
    );
    expect(leaked).toEqual(["PWNED-7731"]);
  });
});

describe("statistics", () => {
  it("uses the population standard deviation", () => {
    expect(stdev([70, 70, 70])).toBe(0);
    expect(stdev([60, 70, 80])).toBeCloseTo(8.1649, 3);
    expect(mean([1, 2, 3])).toBe(2);
  });

  it("takes the nearest rank for a percentile", () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(100);
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([], 50)).toBe(0);
  });

  it("handles an empty sample everywhere rather than returning NaN", () => {
    expect(mean([])).toBe(0);
    expect(stdev([])).toBe(0);
    expect(rate([])).toBe(0);
    expect(allAgree([])).toBe(true);
  });

  it("counts agreement and rates", () => {
    expect(allAgree(["ready", "ready"])).toBe(true);
    expect(allAgree(["ready", "ask"])).toBe(false);
    expect(rate([true, true, false, false])).toBe(0.5);
  });
});

describe("cost", () => {
  it("prices each token class per million", () => {
    const cost = estimateCost(
      { input: 1_000_000, output: 100_000, cacheRead: 2_000_000, cacheWrite: 0 },
      { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
    );
    // 3.00 + 1.50 + 0.60
    expect(cost).toBeCloseTo(5.1, 5);
  });

  it("is zero when the provider is free", () => {
    expect(
      estimateCost(
        { input: 9_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 },
        { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
      ),
    ).toBe(0);
  });
});
