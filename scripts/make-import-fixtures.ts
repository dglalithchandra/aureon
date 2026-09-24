import { writeFileSync, mkdirSync } from "node:fs";
import { Document, Packer, Paragraph } from "docx";

/**
 * Builds the two binary fixtures the import tests read
 * (`tests/fixtures/import/`). They are generated rather than downloaded so
 * the repository carries no file from anyone's real project, and so the
 * expected text is written here next to the thing that produces it.
 *
 *   npx tsx scripts/make-import-fixtures.ts
 *
 * The PDF is written by hand: a page, one Helvetica font and two text
 * lines, with a real cross-reference table. That is enough for pdf.js
 * (through unpdf) to extract the lines, and it keeps a PDF writer out of
 * the dependency list for the sake of one test file.
 */

const OUT_DIR = "tests/fixtures/import";

/** Kept in sync with tests/unit/import-extract.test.ts. */
export const FIXTURE_LINES = [
  "Aureon import fixture.",
  "Sellers list handmade items and buyers check out with Stripe.",
  "Budget is 40,000 dollars over eight weeks.",
];

function pdfEscape(line: string): string {
  return line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildPdf(lines: string[]): Buffer {
  const content = [
    "BT",
    "/F1 12 Tf",
    "14 TL",
    "72 720 Td",
    ...lines.map((line) => `(${pdfEscape(line)}) Tj T*`),
    "ET",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R " +
      "/Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefAt = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefAt}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

async function buildDocx(lines: string[]): Promise<Buffer> {
  const doc = new Document({
    sections: [{ children: lines.map((text) => new Paragraph(text)) }],
  });
  return Packer.toBuffer(doc);
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  writeFileSync(`${OUT_DIR}/requirements.pdf`, buildPdf(FIXTURE_LINES.slice(0, 2)));
  writeFileSync(`${OUT_DIR}/requirements.docx`, await buildDocx(FIXTURE_LINES));
  writeFileSync(
    `${OUT_DIR}/requirements.md`,
    `# ${FIXTURE_LINES[0]}\n\n${FIXTURE_LINES.slice(1).join("\n\n")}\n`,
    "utf8",
  );

  process.stdout.write(`Wrote fixtures to ${OUT_DIR}\n`);
}

void main();
