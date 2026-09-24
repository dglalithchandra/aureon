import { expect, generateScope, test } from "./helpers";

/**
 * The calibration loop's two gates, from the browser. Both pages are
 * reachable without an account, and both say plainly why they are empty —
 * the rest of the loop needs a signed-in workspace and an approved
 * project, which the integration tests cover.
 */

test("recording actuals waits for an approved version", async ({ page }) => {
  test.slow();
  const id = await generateScope(page);

  await page.goto(`/projects/${id}/actuals`);
  await expect(page.getByRole("heading", { name: "Record actuals" })).toBeVisible();
  await expect(page.getByText(/once a client has approved a version/i)).toBeVisible();
  // Nothing to fill in until then.
  await expect(page.getByRole("button", { name: /Record actuals/ })).toHaveCount(0);
});

test("the analytics page explains that calibration needs an account", async ({
  page,
}) => {
  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "Estimate accuracy" })).toBeVisible();
  await expect(page.getByText(/needs an account/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});
