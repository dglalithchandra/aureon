/**
 * One budget for everything the user types: the raw brief, every answer and
 * every added description (BUG-10). Measured in UTF-8 bytes, because that is
 * what storage and the model cost scale with — 17,000 Kannada characters are
 * 51,000 bytes, so a character limit would accept text the pipeline then
 * rejects on the next answer.
 */

export const USER_CONTENT_BUDGET_BYTES = 50_000;

const encoder = new TextEncoder();

/** Size of a string in UTF-8 bytes, in the browser and on the server. */
export function utf8Bytes(text: string): number {
  return encoder.encode(text).length;
}

/** The same wording wherever the budget is enforced. */
export function budgetExceededMessage(bytes: number): string {
  return (
    `Your text is ${bytes.toLocaleString("en-US")} bytes and the limit is ` +
    `${USER_CONTENT_BUDGET_BYTES.toLocaleString("en-US")} bytes ` +
    "(one byte per Latin character, up to four for other scripts). Please shorten it."
  );
}

/** True when `bytes` still fits in the budget. */
export function withinBudget(bytes: number): boolean {
  return bytes <= USER_CONTENT_BUDGET_BYTES;
}
