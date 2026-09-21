import DOMPurify from "isomorphic-dompurify";

/**
 * Strip all HTML and return plain text. Use when feeding strings into the
 * LLM (e.g. README content) so model output cannot be steered by injected
 * markup or angle-bracket tokens that look like tool-use tags.
 */
export function stripHtml(input: string): string {
  return DOMPurify.sanitize(input, { ALLOWED_TAGS: [], KEEP_CONTENT: true });
}

/**
 * Truncate text to `maxChars`, breaking on a word boundary when possible.
 * Used before passing user content to the LLM to bound prompt size.
 */
export function truncateText(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  const slice = input.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  return lastSpace > maxChars - 50 ? slice.slice(0, lastSpace) + "…" : slice + "…";
}
