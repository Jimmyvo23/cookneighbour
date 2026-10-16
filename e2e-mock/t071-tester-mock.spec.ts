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
} from "./helpers";

// T-071 tester: dark mode at 375 px, the confirm step and the chef's confirmed line (MOCK data).
let storageTried: string[];
test.beforeEach(async ({ page }) => {
  storageTried = await blockAllStorage(page);
});
test.afterEach(() => {
  expect(storageTried).toEqual([]);
});

for (const mode of ["light", "dark"] as const) {
  test(`customer 375 px ${mode}: confirm step and result are accessible`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: mode });
    await page.setViewportSize({ width: 375, height: 800 });
    await loginCustomer(page);
    await setMockHooks(page, { seedCustomer: true });
    await openPage(page, `/bookings/${SEEDED.A05}`);
    await expect(page.getByTestId("loading")).toHaveCount(0);
    await expectNoAxeViolations(page);
    await page.getByRole("button", { name: "I picked up my meals" }).click();
    await expect(page.getByTestId("pickup-confirm")).toContainText(
      "This can't be undone",
    );
    await expectNoAxeViolations(page);
    await page.getByRole("button", { name: "Yes, I picked them up" }).click();
    await expect(page.getByTestId("picked-up")).toBeFocused();
    expect(await scrollsSideways(page)).toBe(false);
    await expectNoAxeViolations(page);
  });

  test(`chef 375 px ${mode}: confirmed line is accessible`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: mode });
    await page.setViewportSize({ width: 375, height: 800 });
    await loginChef(page);
    await setMockHooks(page, { pickedUpSeeded: [SEEDED.A05] });
    await openPage(page, `/chef/bookings/${SEEDED.A05}`);
    await expect(page.getByTestId("picked-up")).toBeVisible();
    expect(await scrollsSideways(page)).toBe(false);
    await expectNoAxeViolations(page);
  });
}
