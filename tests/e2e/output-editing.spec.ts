import { type Page } from "@playwright/test";
import { expect, generateScope, saveEdits, setField, test } from "./helpers";

/**
 * UX-02: every section of both views is editable, and what was edited is
 * still there after a reload — which is the only proof that the edit reached
 * the database rather than React state.
 */

test("edits in both views survive a reload", async ({ page }) => {
  test.slow();
  const id = await generateScope(page);

  await page.getByRole("button", { name: "Edit", exact: true }).click();

  // ── Client view ───────────────────────────────────────────────────────
  await page.getByLabel("Size of Auth").selectOption("LARGE");
  await setField(page, "Module name", "Sign-in");
  await setField(page, "Milestone phase 1", "Month 0");
  await setField(page, "Milestone name 1", "Groundwork");

  await page.getByRole("button", { name: "Add deliverable" }).first().click();
  await setField(page, "deliverable", "Role matrix agreed", { nth: 1 });

  await page.getByRole("button", { name: "Add assumption" }).click();
  await setField(page, "assumption", "One organisation, no multi-tenancy", {
    multiline: true,
    nth: 1,
  });

  await setField(page, "open item", "Confirm the budget and the deadline", {
    multiline: true,
  });

  // ── Engineer view ─────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Engineer View" }).click();
  await page.getByLabel("Size of Auth").selectOption("LARGE");
  await setField(page, "Notes on Auth", "Session cookie, HttpOnly and SameSite=Lax", {
    multiline: true,
  });
  await page.getByRole("button", { name: "Add tech" }).first().click();
  await setField(page, "tech for Auth", "Auth.js", { nth: 1 });
  await page.getByRole("button", { name: "Add endpoint" }).click();
  await setField(page, "endpoint of Auth", "POST /api/logout", { nth: 1 });
  await page.getByRole("button", { name: "Add step" }).click();
  await setField(page, "build step", "Admin", { nth: 1 });
  await setField(page, "Focus of Sprint 1", "Sign-in and roles");

  await saveEdits(page);

  // ── Reload, and read it back ──────────────────────────────────────────
  await page.goto(`/output/${id}`);
  await expect(page.getByText("Sign-in", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Month 0")).toBeVisible();
  await expect(page.getByText("Groundwork")).toBeVisible();
  await expect(page.getByText("Role matrix agreed")).toBeVisible();
  await expect(page.getByText("One organisation, no multi-tenancy")).toBeVisible();
  await expect(page.getByText("Confirm the budget and the deadline")).toBeVisible();

  await page.getByRole("button", { name: "Engineer View" }).click();
  await expect(page.getByText("Auth.js")).toBeVisible();
  await expect(page.getByText("POST /api/logout")).toBeVisible();
  await expect(page.getByText("Sign-in and roles")).toBeVisible();
  await expect(page.getByText("Session cookie, HttpOnly and SameSite=Lax")).toBeVisible();
  // The size edit reached the row, so the estimate is recomputed from LARGE.
  await expect(page.getByRole("cell", { name: "large" }).first()).toBeVisible();
});

test("a saved edit is a version of its own", async ({ page }) => {
  test.slow();
  const id = await generateScope(page);

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await setField(page, "Project summary", "A tool for account managers, rewritten.", {
    multiline: true,
  });
  await saveEdits(page);

  await page.goto(`/projects/${id}/versions`);
  await expect(page.getByText("Edited by hand")).toBeVisible();
});

test("unsaved edits are guarded and kept in the browser", async ({ page }) => {
  test.slow();
  await generateScope(page);

  // Nothing pending: leaving is not questioned.
  expect(await beforeUnloadIsBlocked(page)).toBe(false);

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await setField(page, "Project summary", "A tool for account managers, in one place.", {
    multiline: true,
  });
  await expect(page.getByTestId("unsaved-notice")).toBeVisible();
  expect(await beforeUnloadIsBlocked(page)).toBe(true);

  // An in-app link asks first, and stays put when the answer is no.
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByRole("link", { name: "Back to your scopes" }).click();
  await expect(page).toHaveURL(/\/output\//);

  // The 10-second autosave puts the draft in this browser…
  await expect(page.getByTestId("unsaved-notice")).toContainText("kept in this browser", {
    timeout: 30_000,
  });

  // …and a fresh load offers it back rather than applying it silently.
  await page.reload();
  const recovered = page.getByTestId("recovered-draft");
  await expect(recovered).toBeVisible();
  await expect(page.getByText("A tool for account managers, in one place.")).toBeHidden();
  await recovered.getByRole("button", { name: "Restore them" }).click();
  await expect(
    page.getByText("A tool for account managers, in one place."),
  ).toBeVisible();
});

/** Does the page object to being left? Dispatching the event is the only ask. */
async function beforeUnloadIsBlocked(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

test("the project title is stored, not derived", async ({ page }) => {
  test.slow();
  const id = await generateScope(page);

  await page.getByRole("button", { name: "Edit project title" }).click();
  const title = page.getByRole("textbox", { name: "Project title" });
  await title.fill("Account manager console");
  await Promise.all([
    // The rename is one request; wait for it before asking the server again.
    page.waitForResponse(
      (res) => res.url().includes(`/api/projects/${id}`) && res.status() === 200,
    ),
    title.press("Enter"),
  ]);

  await page.goto(`/output/${id}`);
  await expect(page.getByRole("button", { name: "Edit project title" })).toContainText(
    "Account manager console",
  );

  // And the list the title was invented for shows the same thing.
  await page.goto("/projects");
  await expect(page.getByText("Account manager console")).toBeVisible();
});
