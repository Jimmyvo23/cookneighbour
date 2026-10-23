import { expect, test } from "@playwright/test";
import {
  SEEDED,
  blockAllStorage,
  expectNoAxeViolations,
  loginChef,
  loginCustomer,
  openPage,
  scrollsSideways,
  setMockHooks,
  signUpCustomer,
} from "./helpers";

// T-077 Tester additions, MOCK mode: keyboard-only focus for the T-076 delete flow, and phone
// width plus dark mode on every frozen page. All data is made up.
test.beforeEach(async ({ page }) => {
  await blockAllStorage(page);
});

test("T-076: keyboard only, Delete moves focus to the question and a delete lands on the saved line, and the notice is announced", async ({
  page,
}) => {
  await signUpCustomer(page);
  await openPage(page, "/allergies");
  await page.getByRole("checkbox", { name: "I have no allergies" }).check();
  await page.getByRole("checkbox", { name: "I have no dietary needs" }).check();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByTestId("profile-status")).toContainText("Saved");

  const del = page.getByRole("button", { name: "Delete saved profile" });
  await del.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("confirm-delete")).toBeFocused();
  // Tab from the question reaches the two buttons, in order.
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Yes, delete it" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  const status = page.getByTestId("profile-status");
  await expect(status).toContainText("deleted");
  await expect(status).toHaveAttribute("role", "status");
  await expect(page.getByTestId("saved-state")).toBeFocused();
  await expect(page.getByTestId("saved-state")).toContainText(
    "Nothing is saved",
  );
  // Focus is not trapped: Tab leaves the line to the next control.
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("saved-state")).not.toBeFocused();
});

for (const mode of ["light", "dark"] as const) {
  test(`frozen pages at 375 px, ${mode}: no sideways scroll, axe clean (chef and customer)`, async ({
    page: chefPage,
    browser,
  }) => {
    let page = chefPage;
    await page.setViewportSize({ width: 375, height: 800 });
    await page.emulateMedia({ colorScheme: mode });
    await loginChef(page);
    await setMockHooks(page, {
      frozenSeeded: [SEEDED.A03, SEEDED.A04, SEEDED.A05, SEEDED.A06],
    });
    for (const id of [SEEDED.A03, SEEDED.A04, SEEDED.A05, SEEDED.A06]) {
      await openPage(page, `/chef/bookings/${id}`);
      await expect(page.getByTestId("frozen-notice"), id).toBeVisible();
      expect(await scrollsSideways(page)).toBe(false);
      await expectNoAxeViolations(page);
    }
    // A fresh browser context: the chef is still signed in on this one.
    const ctx = await browser.newContext({
      viewport: { width: 375, height: 800 },
      colorScheme: mode,
    });
    page = await ctx.newPage();
    await blockAllStorage(page);
    await loginCustomer(page);
    await setMockHooks(page, {
      seedCustomer: true,
      frozenSeeded: [SEEDED.A03, SEEDED.A04, SEEDED.A05, SEEDED.A06],
    });
    for (const id of [SEEDED.A03, SEEDED.A04, SEEDED.A05, SEEDED.A06]) {
      await openPage(page, `/bookings/${id}`);
      await expect(page.getByTestId("frozen-notice"), id).toBeVisible();
      expect(await scrollsSideways(page)).toBe(false);
      await expectNoAxeViolations(page);
    }
  });
}
