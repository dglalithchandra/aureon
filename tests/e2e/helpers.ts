import { expect, test as base, type Page } from "@playwright/test";

/**
 * Shared steps for the browser tests. Everything here drives the app the way
 * a person would — no seeded database, no direct API calls except the mock's
 * control port, which stands in for "the model answers differently now".
 */

const CONTROL = `http://127.0.0.1:${process.env.E2E_CONTROL_PORT ?? 3211}`;

let clientIp = 0;

/**
 * `test` with one client address per test. The LLM routes allow six calls a
 * minute from one address (RATE_LIMITS.llmRoute) — a sensible limit for one
 * person, and one the whole suite would otherwise share.
 */
export const test = base.extend({
  // `runTest` is Playwright's `use`, renamed: the react-hooks lint rule reads
  // a bare `use(...)` here as a misplaced React hook.
  page: async ({ page }, runTest) => {
    clientIp += 1;
    await page.setExtraHTTPHeaders({
      "x-forwarded-for": `203.0.113.${clientIp % 250}`,
    });
    await runTest(page);
  },
});

export { expect } from "@playwright/test";

export const BRIEF =
  "We need an internal tool for account managers to look after client accounts " +
  "in one place: staff sign-in, an admin area for roles, and user records. " +
  "Roughly eight weeks of work for a small team.";

/** What the mock answers for `tool` from now on. */
export async function overrideModel(tool: string, payload: unknown): Promise<void> {
  const res = await fetch(`${CONTROL}/override`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tool, payload }),
  });
  if (!res.ok) throw new Error(`control /override failed: ${res.status}`);
}

export async function resetModel(): Promise<void> {
  await fetch(`${CONTROL}/reset`, { method: "POST" });
}

/**
 * Wait until the chat is interactive, not merely painted: a file input can
 * only work once React is listening, and `setInputFiles` fires its change
 * event exactly once.
 */
export async function waitForChatReady(page: Page): Promise<void> {
  const box = page.getByLabel("Project requirements input");
  await box.fill("ready?");
  await expect(page.getByRole("button", { name: "Submit" })).toBeEnabled();
  await box.fill("");
}

/**
 * From an empty chat to a finished scope, the short way: round 1 ends with
 * questions outstanding, and "Generate anyway" takes the draft from there.
 * Returns the project id.
 */
export async function generateScope(page: Page): Promise<string> {
  await page.goto("/chat");
  await page.getByLabel("Project requirements input").fill(BRIEF);
  await page.getByRole("button", { name: "Submit" }).click();

  const generateAnyway = page.getByTestId("generate-anyway");
  await expect(generateAnyway).toBeVisible({ timeout: 120_000 });
  await generateAnyway.click();

  await page.waitForURL(/\/output\/[0-9a-f-]{36}/, { timeout: 60_000 });
  // The two finalize jobs run in the server process; the page swaps itself
  // for the editor as soon as both views have landed.
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible({
    timeout: 120_000,
  });
  const id = page.url().split("/output/")[1];
  if (!id) throw new Error(`no project id in ${page.url()}`);
  return id;
}

/** Type into one inline SectionEditor, found by the label it announces. */
export async function setField(
  page: Page,
  label: string,
  value: string,
  options: { multiline?: boolean; nth?: number } = {},
): Promise<void> {
  const { multiline = false, nth = 0 } = options;
  await page
    .getByRole("button", { name: `Edit ${label}`, exact: true })
    .nth(nth * 2) // Each editor offers the value and a pencil, both labelled.
    .click();
  const box = page.getByRole("textbox", { name: label, exact: true });
  await box.fill(value);
  if (multiline) {
    await page.getByRole("button", { name: "Confirm edit" }).click();
  } else {
    await box.press("Enter");
  }
}

export async function saveEdits(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
}
