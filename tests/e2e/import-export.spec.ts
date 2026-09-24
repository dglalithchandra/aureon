import { expect, generateScope, test, waitForChatReady } from "./helpers";

/**
 * Bringing requirements in as a file, and taking the scope out as a
 * document, a backlog or one copied section.
 */

test("a file becomes text the user can check before anything is created", async ({
  page,
}) => {
  await page.goto("/chat");
  await waitForChatReady(page);

  const input = page.locator('input[type="file"]');
  await input.setInputFiles("tests/fixtures/import/requirements.docx");

  // The text lands in the box, and the box is still the box: editable.
  const box = page.getByLabel("Project requirements input");
  await expect(box).toHaveValue(/Sellers list handmade items/, { timeout: 30_000 });
  await expect(page.getByTestId("import-notice")).toContainText("requirements.docx");
  await expect(page.getByTestId("import-notice")).toContainText("Check it");

  await box.fill(
    (await box.inputValue()) + "\nThe budget is 40,000 dollars over eight weeks.",
  );
  await expect(box).toHaveValue(/40,000 dollars/);

  // Nothing has been created: this is still the empty chat.
  await expect(page).toHaveURL(/\/chat$/);
});

test("a PDF comes in the same way", async ({ page }) => {
  await page.goto("/chat");
  await waitForChatReady(page);
  await page
    .locator('input[type="file"]')
    .setInputFiles("tests/fixtures/import/requirements.pdf");

  await expect(page.getByLabel("Project requirements input")).toHaveValue(
    /Sellers list handmade items/,
    { timeout: 30_000 },
  );
  await expect(page.getByTestId("import-notice")).toContainText("1 pages");
});

test("a file it cannot read says so instead of failing quietly", async ({ page }) => {
  await page.goto("/chat");
  await waitForChatReady(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "design.sketch",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("not a document"),
  });

  await expect(page.getByText(/Aureon reads \.txt, \.md, \.pdf and \.docx/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByLabel("Project requirements input")).toHaveValue("");
});

test("a section copies as Markdown", async ({ page, context }) => {
  test.slow();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await generateScope(page);

  const summary = page.locator("#summary");
  await summary.getByTestId("copy-section").click();
  await expect(summary.getByTestId("copy-section")).toContainText("Copied");

  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain("## Summary");
  expect(clipboard).toContain("account managers");
});

test("the Word and CSV exports download", async ({ page }) => {
  test.slow();
  await generateScope(page);

  for (const [label, suffix] of [
    ["Download Word (.docx)", ".docx"],
    ["Jira CSV (issues)", "jira.csv"],
    ["Linear CSV (issues)", "linear.csv"],
  ] as const) {
    await page.getByRole("button", { name: "Export" }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: label }).click(),
    ]);
    expect(download.suggestedFilename()).toContain(suffix);
  }
});
