import { BRIEF, expect, test } from "./helpers";

/**
 * UX-02 item 5: a scope can be generated before the questions are finished,
 * as long as the document says what it is.
 */

test("Generate anyway produces a labelled low-confidence draft", async ({ page }) => {
  test.slow();
  await page.goto("/chat");
  await page.getByLabel("Project requirements input").fill(BRIEF);
  await page.getByRole("button", { name: "Submit" }).click();

  const generateAnyway = page.getByTestId("generate-anyway");
  await expect(generateAnyway).toBeVisible({ timeout: 120_000 });
  await generateAnyway.click();

  await page.waitForURL(/\/output\/[0-9a-f-]{36}/, { timeout: 60_000 });
  const banner = page.getByTestId("low-confidence-banner");
  await expect(banner).toBeVisible({ timeout: 150_000 });
  await expect(banner).toContainText("Low confidence draft");

  // And it is a property of the document, not of the click: still there on
  // a fresh load.
  await page.reload();
  await expect(page.getByTestId("low-confidence-banner")).toBeVisible();
});
