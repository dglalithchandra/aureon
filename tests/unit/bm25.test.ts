import { describe, expect, it } from "vitest";
import { bm25Rank } from "@/lib/github/bm25";

interface Repo {
  name: string;
  text: string;
}

const text = (r: Repo): string => r.text;

describe("bm25Rank", () => {
  it("returns [] for no candidates", () => {
    expect(bm25Rank("invoice", [], text)).toEqual([]);
  });

  it("scores everything 0 and keeps input order when the query is only stop words", () => {
    const repos: Repo[] = [
      { name: "a", text: "invoice tool" },
      { name: "b", text: "chat app" },
    ];
    const ranked = bm25Rank("the and of", repos, text);
    expect(ranked.map((r) => [r.item.name, r.score])).toEqual([
      ["a", 0],
      ["b", 0],
    ]);
  });

  it("ranks the most relevant document first and never drops a candidate", () => {
    const repos: Repo[] = [
      { name: "chat", text: "Realtime chat with websockets and emoji" },
      { name: "invoicing", text: "Invoicing and billing for freelancers, PDF invoices" },
      { name: "shop", text: "Shop admin with billing reports" },
    ];

    const ranked = bm25Rank("freelancer invoicing billing", repos, text);

    expect(ranked.map((r) => r.item.name)).toEqual(["invoicing", "shop", "chat"]);
    expect(ranked[2]?.score).toBe(0);
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it("weights a rare term above a common one (IDF)", () => {
    const repos: Repo[] = [
      { name: "common-1", text: "dashboard" },
      { name: "common-2", text: "dashboard" },
      { name: "rare", text: "kanban" },
    ];
    const ranked = bm25Rank("dashboard kanban", repos, text);
    expect(ranked[0]?.item.name).toBe("rare");
  });

  it("normalises for document length unless b = 0", () => {
    const repos: Repo[] = [
      { name: "long", text: "invoice alpha beta gamma delta epsilon zeta" },
      { name: "short", text: "invoice" },
    ];

    const withLength = bm25Rank("invoice", repos, text);
    expect(withLength[0]?.item.name).toBe("short");
    expect(withLength[0]!.score).toBeGreaterThan(withLength[1]!.score);

    const noLength = bm25Rank("invoice", repos, text, { b: 0 });
    expect(noLength[0]!.score).toBeCloseTo(noLength[1]!.score, 10);
  });

  it("is case- and punctuation-insensitive", () => {
    const repos: Repo[] = [
      { name: "x", text: "Stripe-Billing!" },
      { name: "y", text: "unrelated words" },
    ];
    expect(bm25Rank("STRIPE billing", repos, text)[0]?.item.name).toBe("x");
  });
});
