import { expect, test } from "@playwright/test";
import {
  SEEDED,
  blockAllStorage,
  expectNoAxeViolations,
  loginCustomer,
  openPage,
  scrollsSideways,
  setMockHooks,
} from "./helpers";

// T-081 tester: the last confirmed pickup completes the booking (MOCK data). 375 px, light and
// dark, axe, focus after the click, no sideways scroll, and no review/pickup action left dead.
let storageTried: string[];
test.beforeEach(async ({ page }) => {
  storageTried = await blockAllStorage(page);
});
test.afterEach(() => {
  expect(storageTried).toEqual([]);
});

for (const mode of ["light", "dark"] as const) {
  test(`customer 375 px ${mode}: confirming the last day shows Completed, keeps the picked-up line, sane focus`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: mode });
    await page.setViewportSize({ width: 375, height: 800 });
    await loginCustomer(page);
    await setMockHooks(page, { seedCustomer: true });
    await openPage(page, `/bookings/${SEEDED.A05}`);
    await expect(page.getByTestId("loading")).toHaveCount(0);
    await expect(page.getByTestId("status")).not.toContainText(/completed/i);
    await page.getByRole("button", { name: "I picked up my meals" }).click();
    await page.getByRole("button", { name: "Yes, I picked them up" }).click();
    await expect(page.getByTestId("status")).toContainText(/completed/i);
    const line = page.getByTestId("picked-up");
    await expect(line).toContainText("Picked up on");
    // The clicked button is gone; focus moved to the confirmation line, not lost to <body>.
    await expect(line).toBeFocused();
    await expect(
      page.getByRole("button", { name: "I picked up my meals" }),
    ).toHaveCount(0);
    await expect(page.getByTestId("pickup-confirm")).toHaveCount(0);
    expect(await scrollsSideways(page)).toBe(false);
    await expectNoAxeViolations(page);
    // Exactly one confirmation line.
    await expect(page.getByTestId("picked-up")).toHaveCount(1);
  });
}
