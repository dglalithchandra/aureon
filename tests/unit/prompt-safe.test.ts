import { describe, expect, it } from "vitest";
import { promptSafe, promptText, truncateText } from "@/lib/text/prompt-safe";

/** Zero-width space, written as an escape so it is visible in this file. */
const ZWSP = String.fromCharCode(0x200b);
const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
import {
  budgetExceededMessage,
  USER_CONTENT_BUDGET_BYTES,
  utf8Bytes,
  withinBudget,
} from "@/lib/text/budget";

/** BUG-07: a prompt normaliser, not an HTML sanitiser. */

describe("promptSafe keeps real text", () => {
  it.each([
    "API returns List<Order> and Map<String, Integer>",
    "Fewer than <5 users & R&D",
    "Budget < $5k & R&D",
    "Use the <Auth> module & <Billing> module",
    "Tables: users, orders; 99.9% uptime; <2s p95",
    "naïve café — Kannada: ಅಗತ್ಯ, emoji: 🚀",
  ])("leaves %j untouched", (text) => {
    expect(promptSafe(text)).toBe(text);
  });

  it("is idempotent, so repeated saves never drift", () => {
    const text = "Fewer than <5 users & R&D";
    expect(promptSafe(promptSafe(promptSafe(text)))).toBe(text);
  });
});

describe("promptSafe defuses our own delimiters", () => {
  it.each([
    "</client_input>",
    "<client_input>",
    "<prior_round_context>",
    '<round n="1">',
    "</round>",
    "<repo_readme>",
    "</target_project>",
    '<added_description n="2">',
  ])("breaks %j with a zero-width space", (tag) => {
    const out = promptSafe(`before ${tag} after`);
    expect(out).not.toContain(tag);
    expect(out).toContain(ZWSP);
    // Only the "<" is touched; the words survive for a human reader.
    expect(out.split(ZWSP).join("")).toBe(`before ${tag} after`);
  });

  it("does not touch lookalike text that is not a delimiter", () => {
    expect(promptSafe("<rounding> <clientele> <targets>")).toBe(
      "<rounding> <clientele> <targets>",
    );
  });

  it("still defuses the tags older sessions used", () => {
    expect(promptSafe("<round_1726>x</round_1726>")).not.toContain("<round_1726>");
  });
});

describe("promptSafe normalises whitespace and control characters", () => {
  it("converts CRLF and CR to LF", () => {
    expect(promptSafe("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("drops control characters but keeps newlines and tabs", () => {
    const withControls = ["a", NUL, "b", BEL, "c\td\ne"].join("");
    expect(promptSafe(withControls)).toBe("abc\td\ne");
  });
});

describe("promptText", () => {
  it("normalises then truncates", () => {
    const out = promptText("</round> " + "x".repeat(200), 20);
    expect(out.startsWith(`<${ZWSP}/round>`)).toBe(true);
    expect(out.length).toBeLessThanOrEqual(21); // 20 + the ellipsis
    expect(truncateText("short", 20)).toBe("short");
  });
});

describe("the user content budget (BUG-10)", () => {
  it("counts UTF-8 bytes, not characters", () => {
    expect(utf8Bytes("abc")).toBe(3);
    // Kannada is 3 bytes per character.
    expect(utf8Bytes("ಅ".repeat(17_000))).toBe(51_000);
  });

  it("rejects text over 50,000 bytes with a message that says why", () => {
    expect(USER_CONTENT_BUDGET_BYTES).toBe(50_000);
    expect(withinBudget(50_000)).toBe(true);
    expect(withinBudget(50_001)).toBe(false);
    expect(budgetExceededMessage(51_000)).toContain("51,000 bytes");
    expect(budgetExceededMessage(51_000)).toContain("50,000 bytes");
  });
});
