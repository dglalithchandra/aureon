/**
 * Text handling for LLM prompts (BUG-07, SEC-04).
 *
 * These strings end up in two places only: a prompt, and React text nodes.
 * React escapes what it renders, so there is nothing to sanitise for HTML
 * here — an HTML sanitiser would delete real content ("List<Order>" became
 * "List"). What a prompt does need is that user or README text cannot close
 * one of OUR delimiter tags and start giving the model instructions.
 *
 * If a future sink ever renders raw HTML (react-markdown with rehype-raw, or
 * dangerouslySetInnerHTML), sanitise at THAT point — not here.
 */

/**
 * Our own prompt delimiters. A "<" that starts one of these is neutralised;
 * every other angle bracket is left alone. The trailing lookahead keeps real
 * words safe: "<round n=" and "<round_17>" are ours, "<rounding>" is not.
 */
const DELIMITER_RE =
  /<(\/?)(client_input|prior_round_context|round|repo_readme|target_project|added_description)(?![A-Za-z0-9])/gi;

/** Zero-width space: invisible to the model, but breaks the tag. */
const ZWSP = String.fromCharCode(0x200b);

/** C0/C1 control characters, except \n and \t, plus the BOM. */
const CONTROL_RE = new RegExp("[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\uFEFF]", "g");

/**
 * Normalise text before it goes into a prompt: one newline style, no control
 * characters, and our own delimiter tags defused. Everything else — angle
 * brackets, ampersands, generics, markup — survives unchanged.
 */
export function promptSafe(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_RE, "")
    .replace(DELIMITER_RE, `<${ZWSP}$1$2`);
}

/**
 * Truncate text to `maxChars`, breaking on a word boundary when possible.
 * Used to bound prompt size.
 */
export function truncateText(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  const slice = input.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  return lastSpace > maxChars - 50 ? slice.slice(0, lastSpace) + "…" : slice + "…";
}

/** `promptSafe` then `truncateText`, the combination every prompt uses. */
export function promptText(input: string, maxChars: number): string {
  return truncateText(promptSafe(input), maxChars);
}
