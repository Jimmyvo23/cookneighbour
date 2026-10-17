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

// T-082 Tester (MOCK): the On hold marker on the lists at phone width, with no wording about a
// reason, and the list agreeing with the detail page for the same booking.
let storageTried: string[];
test.beforeEach(async ({ page }) => {
  storageTried = await blockAllStorage(page);
});
test.afterEach(() => {
  expect(storageTried).toEqual([]);
});

test("customer list at 375 px: marker is plain, neutral, in its row, no sideways scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await loginCustomer(page);
  await setMockHooks(page, { seedCustomer: true, frozenSeeded: [SEEDED.A04] });
  await openPage(page, "/bookings");
  const row = page
    .getByTestId("booking-item")
    .filter({ has: page.getByTestId("on-hold") });
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("on-hold")).toBeVisible();
  await expect(row).not.toContainText(
    /admin|flag|reject|report|reason|dispute/i,
  );
  expect(await scrollsSideways(page)).toBe(false);
  await expectNoAxeViolations(page);
});

test("chef list at 375 px: marker agrees with the detail page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await loginChef(page);
  await setMockHooks(page, { frozenSeeded: [SEEDED.A04] });
  await openPage(page, "/chef/bookings");
  await expect(page.getByTestId("on-hold")).toHaveCount(1);
  expect(await scrollsSideways(page)).toBe(false);
  await openPage(page, `/chef/bookings/${SEEDED.A04}`);
  await expect(page.getByTestId("frozen-notice")).toBeVisible();
});

test("control: with no frozen hook no chef list row is marked", async ({
  page,
}) => {
  await loginChef(page);
  await openPage(page, "/chef/bookings");
  await expect(page.getByTestId("booking-item").first()).toBeVisible();
  await expect(page.getByTestId("on-hold")).toHaveCount(0);
});

test("control: with no frozen hook no customer list row is marked", async ({
  page,
}) => {
  await loginCustomer(page);
  await setMockHooks(page, { seedCustomer: true });
  await openPage(page, "/bookings");
  await expect(page.getByTestId("booking-item").first()).toBeVisible();
  await expect(page.getByTestId("on-hold")).toHaveCount(0);
});
