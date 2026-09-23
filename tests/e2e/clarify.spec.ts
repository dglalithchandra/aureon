import { expect, generateScope, overrideModel, resetModel, test } from "./helpers";
import { makeClientView } from "../fixtures/llm";

/**
 * UX-02 item 4: answering an open item on the output page runs a new round
 * and writes a new version — without a trip through /chat, which no longer
 * has a link here.
 */

test.afterEach(async () => {
  await resetModel();
});

test("clarifying an open item writes a new version", async ({ page }) => {
  test.slow();
  const id = await generateScope(page);

  await expect(page.getByText("Confirm the budget.")).toBeVisible();

  // The second pass comes back with the budget folded in, the way a real
  // model would answer once it has been told.
  const clarified = makeClientView();
  await overrideModel("submit_client_view", {
    ...clarified,
    project_summary:
      "An internal tool for account managers, budgeted at 40,000 dollars over eight weeks.",
    open_items: [],
    assumptions: [...clarified.assumptions, "Budget is fixed at 40,000 dollars."],
  });

  await page.getByRole("button", { name: "Clarify" }).first().click();
  const panel = page.getByTestId("clarify-panel");
  await expect(panel).toBeVisible();
  await panel
    .getByLabel("Your answer")
    .fill("The budget is 40,000 dollars and the deadline is eight weeks.");
  await panel.getByRole("button", { name: "Send answer" }).click();

  // The panel closes once the regenerated scope is on the page.
  await expect(panel).toBeHidden({ timeout: 150_000 });
  await expect(page.getByText(/budgeted at 40,000 dollars/)).toBeVisible();

  await page.goto(`/projects/${id}/versions`);
  const clarifiedVersion = page
    .locator("li")
    .filter({ hasText: "After clarification" })
    .first();
  await expect(clarifiedVersion).toBeVisible();
  await expect(clarifiedVersion).toContainText("v2");
});
