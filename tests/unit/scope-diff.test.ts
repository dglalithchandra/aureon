import { describe, expect, it } from "vitest";
import {
  attributeChange,
  answersOf,
  descriptionSimilarity,
  diffList,
  diffModules,
  diffScopes,
} from "@/lib/versions/diff";
import type { ClientModule, FinalOutput } from "@/lib/schemas/output";
import type { SessionRound } from "@/lib/schemas/mcq";
import { makeClientView, makeEngineerView, makeRound } from "../fixtures/llm";

/** Blueprint step 14: the scope diff, on known pairs. */

function mod(
  name: string,
  size: ClientModule["size"],
  description = `${name} does its job`,
): ClientModule {
  return {
    name,
    description,
    size,
    github_validated: false,
    confidence: null,
    seen_in: [],
  };
}

function output(overrides: {
  modules?: ClientModule[];
  assumptions?: string[];
  openItems?: string[];
  summary?: string;
  score?: number;
}): FinalOutput {
  const client = makeClientView();
  return {
    client: {
      ...client,
      project_summary: overrides.summary ?? client.project_summary,
      modules: overrides.modules ?? client.modules,
      assumptions: overrides.assumptions ?? [],
      open_items: overrides.openItems ?? [],
      confidence_badge: {
        ...client.confidence_badge,
        score: overrides.score ?? client.confidence_badge.score,
      },
    },
    engineer: makeEngineerView(),
  };
}

describe("modules", () => {
  it("sees what was added and what was removed", () => {
    const before = [mod("Auth", "MEDIUM"), mod("Billing", "LARGE")];
    const after = [mod("Auth", "MEDIUM"), mod("Search", "SMALL")];

    expect(diffModules(before, after)).toEqual([
      { kind: "added", name: "Search" },
      { kind: "removed", name: "Billing" },
    ]);
  });

  it("sees a size change as a resize, not as add plus remove", () => {
    expect(diffModules([mod("Auth", "SMALL")], [mod("Auth", "LARGE")])).toEqual([
      { kind: "resized", name: "Auth", fromSize: "SMALL", toSize: "LARGE" },
    ]);
  });

  it("reads a rename from the description that stayed the same", () => {
    const before = [mod("Payments", "LARGE", "Take card payments and handle refunds")];
    const after = [mod("Billing", "LARGE", "Take card payments and handle refunds")];

    expect(diffModules(before, after)).toEqual([
      { kind: "renamed", name: "Billing", previousName: "Payments" },
    ]);
  });

  it("records a rename that also changed size", () => {
    const before = [mod("Payments", "MEDIUM", "Take card payments and handle refunds")];
    const after = [mod("Billing", "LARGE", "Take card payments and handle refunds")];

    expect(diffModules(before, after)).toEqual([
      {
        kind: "renamed",
        name: "Billing",
        previousName: "Payments",
        fromSize: "MEDIUM",
        toSize: "LARGE",
      },
    ]);
  });

  it("does not call two unrelated modules a rename", () => {
    const before = [mod("Payments", "LARGE", "Take card payments and handle refunds")];
    const after = [mod("Messaging", "LARGE", "Buyers and sellers chat about an order")];

    expect(diffModules(before, after)).toEqual([
      { kind: "added", name: "Messaging" },
      { kind: "removed", name: "Payments" },
    ]);
  });

  it("treats a plural or a hyphen as the same module", () => {
    expect(
      diffModules([mod("Notification", "SMALL")], [mod("Notifications", "SMALL")]),
    ).toEqual([]);
  });

  it("is empty for two identical lists", () => {
    const list = [mod("Auth", "MEDIUM"), mod("Billing", "LARGE")];
    expect(diffModules(list, [...list])).toEqual([]);
  });

  it("measures description overlap the way the rename rule expects", () => {
    expect(
      descriptionSimilarity("Take card payments and refunds", "Take card payments"),
    ).toBeGreaterThan(0.5);
    expect(
      descriptionSimilarity("Take card payments", "Schedule appointments for physios"),
    ).toBe(0);
  });
});

describe("lists", () => {
  it("reports additions and removals", () => {
    expect(diffList(["a", "b"], ["b", "c"])).toEqual([
      { kind: "added", text: "c" },
      { kind: "removed", text: "a" },
    ]);
  });

  it("is empty when nothing moved", () => {
    expect(diffList(["a"], ["a"])).toEqual([]);
  });
});

describe("the whole document", () => {
  it("puts together modules, lists, the summary and the score", () => {
    const before = output({
      modules: [mod("Auth", "MEDIUM"), mod("Billing", "LARGE")],
      assumptions: ["Stripe is acceptable"],
      openItems: ["Which courier?"],
      summary: "A marketplace for crafts.",
      score: 62,
    });
    const after = output({
      modules: [mod("Auth", "LARGE"), mod("Payouts", "MEDIUM")],
      assumptions: ["Stripe is acceptable", "Weekly payouts"],
      openItems: [],
      summary: "A marketplace for handmade crafts, with weekly seller payouts.",
      score: 81,
    });

    const diff = diffScopes(before, after);
    expect(diff.modules).toEqual([
      { kind: "added", name: "Payouts" },
      { kind: "resized", name: "Auth", fromSize: "MEDIUM", toSize: "LARGE" },
      { kind: "removed", name: "Billing" },
    ]);
    expect(diff.assumptions).toEqual([{ kind: "added", text: "Weekly payouts" }]);
    expect(diff.openItems).toEqual([{ kind: "removed", text: "Which courier?" }]);
    expect(diff.confidence).toEqual({ from: 62, to: 81, delta: 19 });
    expect(diff.summaryChanged).toBe(true);
    expect(diff.identical).toBe(false);
  });

  it("says so when the two versions are the same document", () => {
    const doc = output({ modules: [mod("Auth", "MEDIUM")], score: 70 });
    const diff = diffScopes(doc, structuredClone(doc));
    expect(diff.identical).toBe(true);
    expect(diff.confidence.delta).toBe(0);
  });

  it("reports a drop in confidence as a negative delta", () => {
    const diff = diffScopes(output({ score: 80 }), output({ score: 65 }));
    expect(diff.confidence.delta).toBe(-15);
  });
});

describe("why it changed", () => {
  const rounds: SessionRound[] = [
    makeRound({
      round_number: 0,
      questions: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          parameter_id: "P-05",
          question: "Which payment provider should sellers be paid through?",
          options: ["Stripe", "Razorpay", "Other"],
          allow_custom: true,
          is_blocker: false,
        },
      ],
      answers: [
        {
          question_id: "11111111-1111-4111-8111-111111111111",
          selected_options: ["Stripe"],
          custom_text: "Weekly payouts to sellers, please",
        },
      ],
    }),
    makeRound({
      round_number: 1,
      questions: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          parameter_id: "P-02",
          question: "Who moderates the reviews?",
          options: ["Admin", "Nobody", "Other"],
          allow_custom: true,
          is_blocker: false,
        },
      ],
      answers: [
        {
          question_id: "22222222-2222-4222-8222-222222222222",
          selected_options: ["Admin"],
          custom_text: null,
        },
      ],
    }),
  ];

  it("flattens every answer with its question", () => {
    const answers = answersOf(rounds);
    expect(answers).toHaveLength(2);
    expect(answers[0]).toMatchObject({
      roundNumber: 0,
      question: "Which payment provider should sellers be paid through?",
    });
    expect(answers[0]?.answer).toContain("Stripe");
  });

  it("points a new Payouts module at the answer that asked for payouts", () => {
    const found = attributeChange({ kind: "added", name: "Payouts" }, answersOf(rounds));
    expect(found).toHaveLength(1);
    expect(found[0]?.answer).toContain("Weekly payouts");
  });

  it("points a new Reviews item at the moderation answer", () => {
    const found = attributeChange(
      { kind: "added", text: "Reviews are moderated by an admin" },
      answersOf(rounds),
    );
    expect(found[0]?.question).toBe("Who moderates the reviews?");
  });

  it("returns nothing when no answer mentions the change", () => {
    expect(
      attributeChange({ kind: "removed", name: "Telemetry" }, answersOf(rounds)),
    ).toEqual([]);
  });

  it("includes an added description as an answer of its own", () => {
    const withDescription = [
      makeRound({
        round_number: 0,
        questions: [],
        answers: [],
        added_description: "We also need offline sync for the driver app.",
      }),
    ];
    const answers = answersOf(withDescription);
    expect(answers[0]?.question).toBe("Added description");
    expect(
      attributeChange({ kind: "added", name: "Offline Sync" }, answers),
    ).toHaveLength(1);
  });
});
