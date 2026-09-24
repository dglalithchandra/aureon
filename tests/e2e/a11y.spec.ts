import { BRIEF, expect, generateScope, overrideModel, resetModel, test } from "./helpers";

/**
 * A11Y-01: the keyboard and screen-reader contract. Each of these was a
 * defect the audit found — a duplicate tooltip id, a dialog with no Escape
 * and no focus trap, an unnamed progress bar, and an "Other" option that
 * could be sent with nothing in it.
 */

test.afterEach(async () => {
  await resetModel();
});

test("the share dialog traps focus, closes on Escape and hands focus back", async ({
  page,
}) => {
  test.slow();
  await generateScope(page);

  const opener = page.getByRole("button", { name: "Approve & share" });
  await opener.click();

  const dialog = page.getByRole("dialog", { name: "Share this scope" });
  await expect(dialog).toBeVisible();
  // Focus moved into the dialog rather than staying on the page behind it.
  await expect(dialog.locator(":focus")).toHaveCount(1);

  // Tab cycles inside: after many tabs the focus is still in the dialog.
  for (let i = 0; i < 12; i += 1) await page.keyboard.press("Tab");
  await expect(dialog.locator(":focus")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("two confidence badges describe themselves separately", async ({ page }) => {
  test.slow();
  await generateScope(page);

  const badges = page.getByRole("button", { name: /Scope confidence \d+ out of 100/ });
  await expect(badges).toHaveCount(2);

  await badges.first().click();
  const first = await badges.first().getAttribute("aria-describedby");
  await badges.nth(1).click();
  const second = await badges.nth(1).getAttribute("aria-describedby");

  expect(first).toBeTruthy();
  expect(second).toBeTruthy();
  expect(first).not.toBe(second);
  // Each points at a tooltip that exists.
  await expect(page.locator(`[id="${second}"]`)).toHaveCount(1);
});

test("an 'Other' option cannot be sent without a sentence", async ({ page }) => {
  test.slow();
  await overrideModel("generate_clarification_questions", {
    questions: [
      {
        parameter_id: "P-02",
        question: "Who are the primary users?",
        options: ["Account managers", "Support leads", "Other (describe)"],
        is_blocker: false,
      },
    ],
  });

  await page.goto("/chat");
  await page.getByLabel("Project requirements input").fill(BRIEF);
  await page.getByRole("button", { name: "Submit" }).click();

  const other = page.getByRole("checkbox", { name: "Select option: Other (describe)" });
  await expect(other).toBeVisible({ timeout: 120_000 });
  const submit = page.getByRole("button", { name: "Submit answers" });

  // The checkbox itself is sr-only; a reader clicks the row, as this does.
  await page.getByText("Other (describe)", { exact: true }).click();
  await expect(other).toBeChecked();
  await expect(submit).toBeDisabled();
  await expect(page.getByText(/needs a sentence/)).toBeVisible();

  await page.getByLabel("+ Describe your answer (required)").fill("Support leads.");
  await expect(submit).toBeEnabled();
});

test("the confidence meter says what it is measuring", async ({ page }) => {
  // The meter lives in the mobile panel; the desktop column shows the roadmap.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/chat");
  // On a phone the panel is an accordion, closed until it is asked for.
  await page.getByRole("button", { name: /^Pipeline ·/ }).click();
  const meter = page.getByRole("progressbar", { name: "Scope confidence" });
  await expect(meter).toHaveCount(1);
  await expect(meter).toHaveAttribute("aria-valuetext", /out of 100/);
});
