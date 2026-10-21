import { expect, test } from "@playwright/test";
import { blockAllStorage, loginAdmin, openPage, vis } from "./helpers";

// T-049 round 3 (Tester), MOCK mode: in a real browser, Cancel on an admin decision form puts
// focus back on the button that opened it, and the MOCK line shows only in MOCK mode (this run).
test.use({ viewport: { width: 375, height: 800 } });

test.beforeEach(async ({ page }) => {
  await blockAllStorage(page);
});

test("admin reports: Cancel returns focus to Resolve, then to Dismiss", async ({
  page,
}) => {
  await loginAdmin(page);
  await openPage(page, "/admin/reports");
  const first = vis(page, "admin-report").first();
  await expect(first).toBeVisible();
  await expect(page.getByTestId("admin-mock-line").first()).toContainText(
    "MOCK",
  );
  await first.getByRole("button", { name: /^Resolve/ }).click();
  await vis(page, "decision-form")
    .getByRole("button", { name: "Cancel" })
    .click();
  await expect(first.getByRole("button", { name: /^Resolve/ })).toBeFocused();
  await first.getByRole("button", { name: /^Dismiss/ }).click();
  await vis(page, "decision-form")
    .getByRole("button", { name: "Cancel" })
    .click();
  await expect(first.getByRole("button", { name: /^Dismiss/ })).toBeFocused();
});
