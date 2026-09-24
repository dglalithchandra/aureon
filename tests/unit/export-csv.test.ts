import { describe, expect, it } from "vitest";
import {
  csvField,
  JIRA_BASE_COLUMNS,
  LINEAR_COLUMNS,
  scopeIssues,
  toJiraCsv,
  toLinearCsv,
} from "@/lib/export/csv";
import { pointsFor } from "@/lib/scoring/effort";
import type { FinalOutput } from "@/lib/schemas/output";
import { makeClientView, makeEngineerView } from "../fixtures/llm";

/**
 * The two CSVs an issue tracker will accept. The column names come from
 * each tool's own import documentation (linked in lib/export/csv.ts); these
 * tests pin them, because a renamed header is a silent import failure.
 */

function output(): FinalOutput {
  const engineer = makeEngineerView();
  return {
    client: makeClientView(),
    engineer: {
      ...engineer,
      module_table: [
        ...engineer.module_table,
        {
          name: "Billing, invoices",
          confidence: null,
          tech_stack: ["Stripe"],
          size: "LARGE",
          dependencies: ["Auth"],
          api_endpoints: ["POST /api/invoices"],
          notes: 'He said "bill monthly"',
        },
      ],
      sprint_breakdown: [
        { sprint: "Sprint 1", focus: "Auth", story_points: 13, modules: ["Auth"] },
        {
          sprint: "Sprint 2",
          focus: "Billing",
          story_points: 21,
          modules: ["Billing, invoices"],
        },
      ],
    },
  };
}

function rows(csv: string): string[][] {
  // Enough of a parser for these fixtures: fields are quoted when they hold
  // a comma, a quote or a newline.
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i += 1) {
    const ch = csv[i];
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" && csv[i + 1] === "\n") {
      row.push(field);
      out.push(row);
      row = [];
      field = "";
      i += 1;
    } else field += ch;
  }
  if (field || row.length > 0) {
    row.push(field);
    out.push(row);
  }
  return out;
}

describe("the rows both formats share", () => {
  it("is one issue per module and one per sprint", () => {
    const doc = output();
    const issues = scopeIssues(doc);

    expect(issues).toHaveLength(
      doc.engineer.module_table.length + doc.engineer.sprint_breakdown.length,
    );
    expect(issues.filter((i) => i.kind === "module")).toHaveLength(2);
    expect(issues.filter((i) => i.kind === "sprint")).toHaveLength(2);
  });

  it("estimates a module from its size and a sprint from its points", () => {
    const issues = scopeIssues(output());
    expect(issues[0]?.estimate).toBe(pointsFor("MEDIUM"));
    expect(issues[1]?.estimate).toBe(pointsFor("LARGE"));
    expect(issues.at(-1)?.estimate).toBe(21);
  });

  it("labels every row so an import can be found again", () => {
    for (const issue of scopeIssues(output())) {
      expect(issue.labels).toContain("aureon");
      expect(issue.labels).toContain(issue.kind);
    }
  });

  it("carries the stack, the dependencies and the endpoints into the body", () => {
    const [first] = scopeIssues(output());
    expect(first?.description).toContain("Stack: Next.js");
    const billing = scopeIssues(output()).find((i) => i.title === "Billing, invoices");
    expect(billing?.description).toContain("Depends on: Auth");
    expect(billing?.description).toContain("POST /api/invoices");
  });
});

describe("the Jira CSV", () => {
  it("starts with the columns Jira's importer maps", () => {
    const [header] = rows(toJiraCsv(output()));
    expect(header?.slice(0, JIRA_BASE_COLUMNS.length)).toEqual([
      "Work type",
      "Summary",
      "Description",
      "Story point estimate",
      "Priority",
    ]);
  });

  it("repeats the Labels column once per value, as Atlassian documents", () => {
    const [header] = rows(toJiraCsv(output()));
    const labelColumns = header?.filter((h) => h === "Labels") ?? [];
    expect(labelColumns).toHaveLength(3);
    expect(header?.filter((h) => h.includes(";"))).toHaveLength(0);
  });

  it("writes a story per module and a task per sprint", () => {
    const [, ...body] = rows(toJiraCsv(output()));
    expect(body.filter((r) => r[0] === "Story")).toHaveLength(2);
    expect(body.filter((r) => r[0] === "Task")).toHaveLength(2);
    expect(body[0]?.[1]).toBe("Auth");
    expect(body[0]?.[3]).toBe(String(pointsFor("MEDIUM")));
    expect(body[1]?.[4]).toBe("High"); // LARGE
  });

  it("quotes a field that holds a comma or a quote", () => {
    const csv = toJiraCsv(output());
    expect(csv).toContain('"Billing, invoices"');
    expect(csv).toContain('""bill monthly""');
    const parsed = rows(csv);
    expect(parsed.find((r) => r[1] === "Billing, invoices")).toBeDefined();
  });

  it("separates records with CRLF, as RFC 4180 says", () => {
    const csv = toJiraCsv(output());
    expect(csv.endsWith("\r\n")).toBe(true);
    // A newline inside a quoted field is allowed, and endpoint lists use
    // one, so the check is on the record separator: header plus four rows.
    const header = csv.slice(0, csv.indexOf("\r\n"));
    expect(header.split(",")[0]).toBe("Work type");
    expect(rows(csv)).toHaveLength(5);
  });
});

describe("the Linear CSV", () => {
  it("uses Linear's own column names, in its own case", () => {
    const [header] = rows(toLinearCsv(output()));
    expect(header).toEqual([
      "Title",
      "Description",
      "Status",
      "Priority",
      "Estimate",
      "Labels",
    ]);
    expect([...LINEAR_COLUMNS]).toEqual(header);
  });

  it("puts every issue in the backlog with Linear's integer priority", () => {
    const [, ...body] = rows(toLinearCsv(output()));
    for (const row of body) expect(row[2]).toBe("Backlog");
    expect(body[0]?.[3]).toBe("3"); // MEDIUM module
    expect(body[1]?.[3]).toBe("2"); // LARGE module
    expect(body.at(-1)?.[3]).toBe("3"); // sprint
  });

  it("puts the labels in one comma-separated field", () => {
    const [, ...body] = rows(toLinearCsv(output()));
    expect(body[0]?.[5]).toBe("aureon,module,size-medium");
    expect(toLinearCsv(output())).toContain('"aureon,module,size-medium"');
  });

  it("carries the estimate as a bare integer", () => {
    const [, ...body] = rows(toLinearCsv(output()));
    expect(body[0]?.[4]).toBe(String(pointsFor("MEDIUM")));
  });
});

describe("csvField", () => {
  it.each([
    ["plain", "plain"],
    ["with, comma", '"with, comma"'],
    ['say "hi"', '"say ""hi"""'],
    ["two\nlines", '"two\nlines"'],
    [13, "13"],
  ])("%s becomes %s", (input, expected) => {
    expect(csvField(input)).toBe(expected);
  });
});
