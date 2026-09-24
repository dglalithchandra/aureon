import "@/lib/server-only";
import { USER_CONTENT_BUDGET_BYTES, utf8Bytes } from "@/lib/text/budget";
import { ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Text out of an uploaded requirements document.
 *
 * The file itself is never stored: it arrives in memory, the text comes
 * out, and the bytes are dropped when the request ends. What the user then
 * submits is the text they saw and could edit, which also means the byte
 * budget (step 11) is enforced in exactly the place it always was.
 *
 * PDF goes through **unpdf** rather than pdf-parse. Both work today, and
 * pdf-parse 2.x is maintained again, but unpdf ships a pdf.js build made
 * for serverless: no native module, no worker file to configure per
 * platform, and canvas is an optional peer needed only for rendering pages
 * as images, which this never does. pdf-parse pulls in pdfjs-dist and
 * @napi-rs/canvas, a native binary that a serverless bundle has to carry
 * and that its own troubleshooting guide says needs per-platform setup.
 * The cost of unpdf is Node 22 or newer, which is this project's floor
 * anyway now that Node 20 is end of life.
 *
 * DOCX goes through **mammoth**, whose `extractRawText` drops the styling
 * we do not want and keeps the paragraphs we do.
 */

export const IMPORT_KINDS = ["txt", "md", "pdf", "docx"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

/** Anything larger is refused before a parser ever sees it. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * A parser may not run forever on a file built to make it. unpdf's own
 * guidance for untrusted PDFs is a page cap and a timeout; both are here.
 */
const EXTRACT_TIMEOUT_MS = 20_000;
const MAX_PDF_PAGES = 300;

/**
 * The most text handed back. The budget is 50,000 bytes, so this leaves
 * room to see what was cut and edit it down rather than re-uploading
 * blind — but not room for a 5 MB book to arrive in a JSON response.
 */
export const MAX_EXTRACTED_BYTES = USER_CONTENT_BUDGET_BYTES * 2;

const EXTENSIONS: Record<string, ImportKind> = {
  txt: "txt",
  text: "txt",
  md: "md",
  markdown: "md",
  pdf: "pdf",
  docx: "docx",
};

const MIME_TYPES: Record<string, ImportKind> = {
  "text/plain": "txt",
  "text/markdown": "md",
  "text/x-markdown": "md",
  "application/pdf": "pdf",
  "application/x-pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

/**
 * What kind of file this is, from its name first and its declared type
 * second. A browser sends `application/octet-stream` for .md often enough
 * that the extension has to win.
 */
export function kindFor(fileName: string, mimeType?: string | null): ImportKind | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const byExtension = EXTENSIONS[ext];
  if (byExtension) return byExtension;
  const mime = (mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return MIME_TYPES[mime] ?? null;
}

export interface ExtractedDocument {
  text: string;
  kind: ImportKind;
  /** Pages, for a PDF. Null for everything else. */
  pages: number | null;
  /** UTF-8 bytes of the text as extracted, before any truncation. */
  bytes: number;
  /** True when the text was longer than MAX_EXTRACTED_BYTES and was cut. */
  truncated: boolean;
  /** True when the text does not fit the user-content budget as it stands. */
  overBudget: boolean;
}

export async function extractDocumentText(input: {
  fileName: string;
  mimeType?: string | null;
  bytes: Uint8Array;
}): Promise<ExtractedDocument> {
  const kind = kindFor(input.fileName, input.mimeType);
  if (!kind) {
    throw new ValidationError(
      "Aureon reads .txt, .md, .pdf and .docx files. Convert the file, or paste the text.",
    );
  }
  if (input.bytes.byteLength === 0) {
    throw new ValidationError("That file is empty.");
  }
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new ValidationError(
      `That file is ${mb(input.bytes.byteLength)} MB and the limit is ${mb(MAX_UPLOAD_BYTES)} MB.`,
    );
  }

  const startedAt = Date.now();
  const { text, pages } = await withTimeout(read(kind, input.bytes), EXTRACT_TIMEOUT_MS);
  const clean = tidy(text);
  if (clean.length === 0) {
    throw new ValidationError(
      kind === "pdf"
        ? "No text in that PDF. A scan of a document is an image — run OCR first, or paste the text."
        : "No text in that file.",
    );
  }

  const bytes = utf8Bytes(clean);
  const kept = truncateToBytes(clean, MAX_EXTRACTED_BYTES);
  logger.info("import.extracted", {
    kind,
    pages,
    bytes,
    truncated: kept.length !== clean.length,
    durationMs: Date.now() - startedAt,
  });

  return {
    text: kept,
    kind,
    pages,
    bytes,
    truncated: kept.length !== clean.length,
    overBudget: bytes > USER_CONTENT_BUDGET_BYTES,
  };
}

async function read(
  kind: ImportKind,
  bytes: Uint8Array,
): Promise<{ text: string; pages: number | null }> {
  if (kind === "txt" || kind === "md") {
    // fatal: false — a stray byte in an otherwise readable brief becomes
    // U+FFFD rather than an error the user cannot act on.
    return {
      text: new TextDecoder("utf-8", { fatal: false }).decode(bytes),
      pages: null,
    };
  }

  if (kind === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new ValidationError(
        `That PDF has ${pdf.numPages} pages and the limit is ${MAX_PDF_PAGES}. Send the part that describes the project.`,
      );
    }
    const { text } = await extractText(pdf, { mergePages: true });
    return { text, pages: pdf.numPages };
  }

  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return { text: value, pages: null };
}

/**
 * PDF extraction returns text laid out for a page, not for reading: soft
 * hyphens at line ends, runs of spaces, and a blank line between every
 * fragment. This makes it look like something a person typed.
 */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/­/g, "") // soft hyphen
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cut at a character boundary that keeps the result under `max` bytes. */
function truncateToBytes(text: string, max: number): string {
  if (utf8Bytes(text) <= max) return text;
  let end = Math.min(text.length, max);
  while (end > 0 && utf8Bytes(text.slice(0, end)) > max) {
    end = Math.floor(end * 0.95);
  }
  return text.slice(0, end).trimEnd();
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new ValidationError(
                "That file took too long to read. Try a smaller one, or paste the text.",
              ),
            ),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "");
}
