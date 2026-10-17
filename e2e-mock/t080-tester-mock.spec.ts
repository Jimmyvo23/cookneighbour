import { expect, test } from "@playwright/test";
import {
  SEEDED,
  blockAllStorage,
  expectNoAxeViolations,
  loginChef,
  openPage,
  scrollsSideways,
} from "./helpers";

// T-080 Tester additions, MOCK mode: the refusal alert at phone width, light and dark, with a
// clean page first (no empty alert) and a stale 409 second. Data is the MOCK seed.
const KEY = "cookneighbour-mock-api-state";
test.beforeEach(async ({ page }) => {
  await blockAllStorage(page);
});

for (const mode of ["light", "dark"] as const) {
  test(`refusal alert at 375 px, ${mode}: none on a clean page, then one focused, no sideways scroll, axe clean`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.emulateMedia({ colorScheme: mode });
    await loginChef(page);
    await openPage(page, `/chef/bookings/${SEEDED.A05}`);
    await expect(page.getByTestId("refusal")).toHaveCount(0);
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "Mark pickup missed" }).click();
    await page.evaluate(
      ([key, id]) => {
        const s = JSON.parse(sessionStorage.getItem(key)!);
        const row = s.chefBookings.find(
          (x: { detail: { id: string } }) => x.detail.id === id,
        );
        row.detail.days = row.detail.days.map(
          (d: { cookedAt: string | null }) =>
            d.cookedAt ? { ...d, pickedUpAt: d.cookedAt } : d,
        );
        sessionStorage.setItem(key, JSON.stringify(s));
      },
      [KEY, SEEDED.A05],
    );
    await page.getByRole("button", { name: "Yes, mark pickup missed" }).click();
    const alert = page.getByTestId("refusal");
    await expect(alert).toBeFocused();
    await expect(alert).toBeInViewport();
    expect(await scrollsSideways(page)).toBe(false);
    await expectNoAxeViolations(page);
  });
}
