import { describe, expect, it } from "vitest";
import { userContentBytes } from "@/lib/storage/session";
import { makeRound, makeSession } from "../fixtures/llm";

describe("userContentBytes", () => {
  it("counts raw_input when there are no answers", () => {
    expect(userContentBytes(makeSession({ raw_input: "hello" }))).toBe(5);
  });

  it("adds selected options and custom text from every answered round", () => {
    const session = makeSession({
      raw_input: "hello",
      rounds: [
        makeRound({
          answers: [
            {
              question_id: "12345678-1234-4abc-8def-1234567890ab",
              selected_options: ["abc", "de"],
              custom_text: "world",
            },
          ],
        }),
      ],
    });
    expect(userContentBytes(session)).toBe(5 + 5 + 5);
  });

  it("counts UTF-8 bytes, not characters", () => {
    // U+0C95 (Kannada KA) is 3 bytes in UTF-8.
    expect(userContentBytes(makeSession({ raw_input: "ಕಕ" }))).toBe(6);
  });
});
