import { expect, test } from "@playwright/test";
import {
  blockAllStorage,
  expectNoAxeViolations,
  loginAdmin,
  openPage,
  scrollsSideways,
  vis,
} from "./helpers";

// T-049, MOCK mode, 375 px: the admin lists for bookings, problem reports and free-trial blocks,
// the decision forms and the read-only chat. The mock adapter (src/lib/mocks/mock-reviews-reports.ts)
// brings in made-up data on the first admin call; nothing is real.
test.use({ viewport: { width: 375, height: 800 } });

let storageTried: string[];
test.beforeEach(async ({ page }) => {
  storageTried = await blockAllStorage(page);
});
test.afterEach(() => {
  expect(storageTried).toEqual([]);
});

test("the admin nav reaches the new lists and axe is clean on each", async ({
  page,
}) => {
  await loginAdmin(page);
  const nav = page.getByRole("navigation", { name: "Admin pages" });
  await nav.getByRole("link", { name: "Problem reports" }).click();
  await expect(vis(page, "admin-report").first()).toBeVisible();
  await expect(page.getByTestId("mock-badge").first()).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
  await expectNoAxeViolations(page);
  await nav.getByRole("link", { name: "Bookings" }).click();
  await expect(vis(page, "admin-booking").first()).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
  await expectNoAxeViolations(page);
  await nav.getByRole("link", { name: "Free-trial blocks" }).click();
  await expect(vis(page, "admin-block").first()).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
  await expectNoAxeViolations(page);
});

test("resolving a report on an accepted booking needs a status and a note, then reports the result", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/admin/reports");
  const first = vis(page, "admin-report").first();
  await expect(first).toBeVisible();
  await first.getByRole("button", { name: /^Resolve/ }).click();
  const form = vis(page, "decision-form");
  await expect(
    form.getByRole("heading", { name: "Resolve this report" }),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  await form.getByRole("button", { name: "Confirm decision" }).click();
  await expect(form.getByLabel("Status the booking gets")).toBeFocused();
  await form.getByLabel("Status the booking gets").selectOption("cancelled");
  await expect(vis(page, "decision-effect")).toContainText("cancelled");
  await form.getByLabel(/^Note/).fill("Checked with both people");
  await form.getByRole("button", { name: "Confirm decision" }).click();
  await expect(vis(page, "decision-result")).toContainText("Decision saved");
  await expect(vis(page, "decision-form")).toHaveCount(0);
});

test("dismissing needs only a note", async ({ page }) => {
  await loginAdmin(page);
  await openPage(page, "/admin/reports");
  await expect(vis(page, "admin-report").first()).toBeVisible();
  const n = await vis(page, "admin-report").count();
  await vis(page, "admin-report")
    .first()
    .getByRole("button", { name: /^Dismiss/ })
    .click();
  const form = vis(page, "decision-form");
  await expect(form.getByLabel("Status the booking gets")).toHaveCount(0);
  await form.getByLabel(/^Note/).fill("Not a real problem");
  await form.getByRole("button", { name: "Confirm decision" }).click();
  await expect(vis(page, "decision-result")).toContainText("Decision saved");
  await expect(vis(page, "admin-report")).toHaveCount(n - 1);
});

test("an open flag is resolved from the bookings list, and bookings page with Load more", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/admin/bookings");
  await expect(vis(page, "admin-booking").first()).toBeVisible();
  await vis(page, "list-count").waitFor();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(vis(page, "admin-booking").nth(21)).toBeVisible();
  await page.getByLabel("Only bookings with an open flag").check();
  const flagged = vis(page, "admin-booking");
  await expect(flagged).toHaveCount(2);
  await flagged
    .first()
    .getByRole("button", { name: /^Resolve flag/ })
    .click();
  const form = vis(page, "decision-form");
  await form.getByLabel("Status the booking gets").selectOption("completed");
  await form.getByLabel(/^Note/).fill("The chef confirmed the visit");
  await form.getByRole("button", { name: "Confirm decision" }).click();
  await expect(vis(page, "decision-result")).toContainText("Decision saved");
  await expect(vis(page, "admin-booking")).toHaveCount(1);
});

test("a second decision on the same item shows the already-decided message", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/admin/reports");
  await vis(page, "admin-report").first().waitFor();
  await page.evaluate(() => {
    const key = "cookneighbour-mock-api-state";
    const s = JSON.parse(sessionStorage.getItem(key)!);
    s.engagement = {
      ...(s.engagement ?? {}),
      hooks: { alreadyDecidedOnce: true },
    };
    sessionStorage.setItem(key, JSON.stringify(s));
  });
  await vis(page, "admin-report")
    .first()
    .getByRole("button", { name: /^Dismiss/ })
    .click();
  const form = vis(page, "decision-form");
  await form.getByLabel(/^Note/).fill("Not a real problem");
  await form.getByRole("button", { name: "Confirm decision" }).click();
  await expect(vis(page, "decision-error")).toContainText("already decided");
  await expect(vis(page, "decision-error")).toBeFocused();
});

test("the chat view is read only", async ({ page }) => {
  await loginAdmin(page);
  await openPage(page, "/admin/bookings");
  await vis(page, "admin-booking")
    .first()
    .getByRole("link", { name: /^Read the chat/ })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Booking chat" }),
  ).toBeVisible();
  await expect(page.getByText(/Admins cannot send messages/)).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  expect(await scrollsSideways(page)).toBe(false);
  await expectNoAxeViolations(page);
});
