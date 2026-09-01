import DOMPurify from "isomorphic-dompurify";

/**
 * Sanitize untrusted strings (LLM output, user input, GitHub READMEs) before
 * any HTML rendering. Always use this rather than `dangerouslySetInnerHTML`
 * directly.
 *
 * Default profile is intentionally restrictive: it strips all scripts,
 * iframes, event handlers, and inline styles. Explicit `allowedTags` may be
 * passed for richer markdown contexts, but each tag should be reviewed.
 */
export interface SanitizeOptions {
  allowedTags?: string[];
  allowedAttrs?: string[];
}

export function sanitizeHtml(input: string, options?: SanitizeOptions): string {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: options?.allowedTags ?? [
      "b",
      "i",
      "em",
      "strong",
      "code",
      "pre",
      "br",
      "p",
      "ul",
      "ol",
      "li",
      "a",
      "h1",
      "h2",
      "h3",
      "h4",
      "blockquote",
      "hr",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ],
    ALLOWED_ATTR: options?.allowedAttrs ?? ["href", "title", "target", "rel"],
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: true,
    USE_PROFILES: { html: true },
  });
}

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
