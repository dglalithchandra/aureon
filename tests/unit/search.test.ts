import { describe, expect, it } from "vitest";
import { buildQueryVariants } from "@/lib/github/search";

const QUALITY = "fork:false archived:false stars:>25 pushed:>2022-01-01";
const IN_FIELDS = "in:name,description,readme";

describe("buildQueryVariants", () => {
  it("uses a broad topic query plus a domain query for a known domain", () => {
    const variants = buildQueryVariants({ domain: "saas", keywords: [] });

    expect(variants).toEqual([
      { label: "topic-broad", q: `topic:saas ${QUALITY}` },
      { label: "domain-broad", q: `saas ${QUALITY} ${IN_FIELDS}` },
    ]);
  });

  it("still finds the topic for a mixed-case label such as 'SaaS'", () => {
    const variants = buildQueryVariants({ domain: "SaaS", keywords: [] });
    expect(variants[0]).toEqual({ label: "topic-broad", q: `topic:saas ${QUALITY}` });
  });

  it("recognises the parts of compound domain labels", () => {
    const variants = buildQueryVariants({
      domain: "Ecommerce Marketplace",
      keywords: [],
    });

    expect(variants[0]?.q).toContain("topic:marketplace");
    expect(variants[1]).toMatchObject({ label: "domain-broad" });
    expect(variants[1]?.q.startsWith("marketplace ")).toBe(true);
  });

  it("adds a language qualifier from the stack hint to every variant", () => {
    const variants = buildQueryVariants({
      domain: "fintech",
      keywords: ["invoice generation"],
      stackHint: "Django + Postgres",
    });

    expect(variants.length).toBeGreaterThan(0);
    for (const v of variants) expect(v.q).toContain("language:python");
  });

  it("drops generic feature terms and keeps the two most specific phrases", () => {
    const variants = buildQueryVariants({
      domain: "Zz",
      keywords: ["Auth", "User Management", "Invoice PDF Export", "Stock alerts"],
    });

    expect(variants).toEqual([
      { label: "feature-1", q: `invoice pdf export ${QUALITY} ${IN_FIELDS}` },
      { label: "feature-2", q: `stock alerts ${QUALITY} ${IN_FIELDS}` },
    ]);
  });

  it("splits camelCase keywords into words", () => {
    const [variant] = buildQueryVariants({ domain: "Zz", keywords: ["InvoiceExport"] });
    expect(variant?.q.startsWith("invoice export ")).toBe(true);
  });

  it("never returns more than 4 variants", () => {
    const variants = buildQueryVariants({
      domain: "saas analytics",
      keywords: ["revenue dashboard", "cohort charts", "csv export"],
      stackHint: "Next.js",
    });
    expect(variants).toHaveLength(4);
  });

  it("falls back to a stack-only query when only the stack is known", () => {
    expect(
      buildQueryVariants({ domain: "Zz", keywords: ["Admin"], stackHint: "Rails" }),
    ).toEqual([{ label: "stack-broad", q: `language:ruby ${QUALITY} ${IN_FIELDS}` }]);
  });

  it("returns no variants (so no GitHub call) when nothing is searchable", () => {
    expect(
      buildQueryVariants({
        domain: "Zz",
        keywords: ["Auth", "Admin", "Users"],
        stackHint: null,
      }),
    ).toEqual([]);
  });
});
