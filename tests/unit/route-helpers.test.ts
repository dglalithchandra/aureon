import { describe, expect, it } from "vitest";
import { validateUuid } from "@/lib/security/route-helpers";

describe("validateUuid", () => {
  it("accepts a v4-shaped UUID", () => {
    expect(validateUuid("12345678-1234-4abc-8def-1234567890ab")).toBe(true);
  });

  it.each([
    ["garbage", "garbage"],
    ["empty", ""],
    ["no hyphens", "12345678123412341234123456789012"],
  ])("rejects %s", (_label, value) => {
    expect(validateUuid(value)).toBe(false);
  });
});
