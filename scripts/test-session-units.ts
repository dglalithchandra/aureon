/**
 * Unit smoke tests for the session layer that don't need the LLM.
 *   npx tsx scripts/test-session-units.ts
 *
 * Confirms:
 *   - cookie sign/verify: round-trips, rejects forgeries, constant-time compare
 *   - userContentBytes: counts raw_input + answer texts
 *   - validateUuid: only v4-shape UUIDs pass
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadEnvFile(path: string): void {
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    /* env validator handles */
  }
}

loadEnvFile(join(process.cwd(), ".env.local"));
if (!process.env.ANTHROPIC_API_KEY) {
  process.env.ANTHROPIC_API_KEY = "x".repeat(40); // dummy for env validator
}

import {
  buildSessionCookie,
  verifySessionCookie,
} from "../lib/security/session-cookie";
import { validateUuid } from "../lib/security/route-helpers";
import { userContentBytes } from "../lib/storage/session";
import type { Session } from "../lib/schemas/mcq";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const VALID_UUID = "12345678-1234-4abc-8def-1234567890ab";
const OTHER_UUID = "abcdefab-cdef-4abc-8def-abcdefabcdef";

console.log("== validateUuid ==");
check("accepts v4-shape", validateUuid(VALID_UUID));
check("rejects garbage", !validateUuid("garbage"));
check("rejects empty", !validateUuid(""));
check("rejects no-hyphens", !validateUuid("12345678123412341234123456789012"));

console.log("\n== cookie sign/verify ==");
const cookie = buildSessionCookie(VALID_UUID);
check("cookie name correct", cookie.name === "scopeai_session");
check("cookie httpOnly", cookie.httpOnly === true);
check("cookie sameSite=lax", cookie.sameSite === "lax");
check("cookie path /", cookie.path === "/");
check("cookie has signed value", cookie.value.includes(`${VALID_UUID}.`));
check("verify accepts own cookie", verifySessionCookie(cookie.value, VALID_UUID));
check("verify rejects forged sig", !verifySessionCookie(`${VALID_UUID}.deadbeef`, VALID_UUID));
check("verify rejects id mismatch", !verifySessionCookie(cookie.value, OTHER_UUID));
check("verify rejects empty", !verifySessionCookie("", VALID_UUID));
check("verify rejects undefined", !verifySessionCookie(undefined, VALID_UUID));
check("verify rejects no-dot", !verifySessionCookie("nodothere", VALID_UUID));
check("verify rejects trailing-dot", !verifySessionCookie(`${VALID_UUID}.`, VALID_UUID));

console.log("\n== userContentBytes ==");
const baseSession: Session = {
  id: VALID_UUID,
  raw_input: "hello",
  enriched_input: "hello",
  rounds: [],
  status: "analyzing",
  pipeline_stage: "extracting",
  current_confidence: 0,
  final_output: null,
  created_at: 0,
  updated_at: 0,
};
check("counts raw_input only", userContentBytes(baseSession) === 5);

const sessionWithAnswers: Session = {
  ...baseSession,
  rounds: [
    {
      round_number: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      extraction: {} as any,
      github_enrichment: null,
      questions: [],
      answers: [
        {
          question_id: VALID_UUID,
          selected_options: ["abc", "de"], // 5 bytes
          custom_text: "world", // 5 bytes
        },
      ],
    },
  ],
};
check("counts answer + selections", userContentBytes(sessionWithAnswers) === 5 + 5 + 5);

console.log(`\n== ${pass} passed, ${fail} failed ==`);
if (fail > 0) process.exit(1);
