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

// T-071 (D-55), MOCK mode: the customer confirms "I picked up my meals" on a chef's-home booking
// and the chef can then no longer mark the pickup missed. The bookings are made up (hooks
// `seedCustomer`, `pickedUpSeeded`, `frozenSeeded`); nothing is stored outside this tab.
// The customer's and the chef's made-up bookings are separate copies in mock mode, so the chef
// half uses `pickedUpSeeded` instead of watching the customer's click.
let storageTried: string[];
test.beforeEach(async ({ page }) => {
  storageTried = await blockAllStorage(page);
});
test.afterEach(() => {
  expect(storageTried).toEqual([]);
});

const BTN = "I picked up my meals";

test("customer: confirm asks first, then shows 'Picked up on' with focus on it", async ({
  page,
}) => {
  await loginCustomer(page);
  await setMockHooks(page, { seedCustomer: true });
  await openPage(page, `/bookings/${SEEDED.A05}`);
  await expect(page.getByTestId("loading")).toHaveCount(0);
  await page.getByRole("button", { name: BTN }).click();
  const q = page.getByRole("heading", {
    name: "Confirm that you picked up your meals?",
  });
  await expect(q).toBeFocused();
  await expect(page.getByTestId("pickup-confirm")).toContainText(
    "This can't be undone",
  );
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Not yet" }).click();
  await expect(page.getByRole("button", { name: BTN })).toBeFocused();
  await page.getByRole("button", { name: BTN }).click();
  await page.getByRole("button", { name: "Yes, I picked them up" }).click();
  const line = page.getByTestId("picked-up");
  await expect(line).toContainText("Picked up on");
  await expect(line).toContainText("Toronto time");
  await expect(line).toBeFocused();
  await expect(page.getByRole("button", { name: BTN })).toHaveCount(0);
  // It survives a reload (the made-up state is kept in this tab).
  await page.reload();
  await expect(page.getByTestId("picked-up")).toContainText("Picked up on");
  await expect(page.getByTestId("pickup-missed-warning")).toHaveCount(0);
});

test("customer: a day with a waiting pickup time can be confirmed; the time is closed", async ({
  page,
}) => {
  await loginCustomer(page);
  await setMockHooks(page, { seedCustomer: true });
  await openPage(page, `/bookings/${SEEDED.A03}`);
  await page.getByRole("button", { name: BTN }).click();
  await page.getByRole("button", { name: "Yes, I picked them up" }).click();
  await expect(page.getByTestId("picked-up")).toBeFocused();
  await expect(page.getByTestId("pickup-history")).toContainText(
    "closed because you picked up the meals",
  );
  await expect(page.getByTestId("propose-form")).toHaveCount(0);
});

test("customer: a frozen booking offers no confirm button", async ({
  page,
}) => {
  await loginCustomer(page);
  await setMockHooks(page, { seedCustomer: true, frozenSeeded: [SEEDED.A05] });
  await openPage(page, `/bookings/${SEEDED.A05}`);
  await expect(page.getByTestId("frozen-notice")).toBeVisible();
  await expect(page.getByRole("button", { name: BTN })).toHaveCount(0);
});

test("customer: a booking at the customer's home shows nothing about pickups", async ({
  page,
}) => {
  await loginCustomer(page);
  await setMockHooks(page, { seedCustomer: true });
  await openPage(page, `/bookings/${SEEDED.A04}`);
  await expect(page.getByTestId("loading")).toHaveCount(0);
  await expect(page.getByTestId("pickups")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /I picked up/ })).toHaveCount(
    0,
  );
});

test("customer at 375 px: the confirm step fits and has no accessibility violations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await loginCustomer(page);
  await setMockHooks(page, { seedCustomer: true });
  await openPage(page, `/bookings/${SEEDED.A05}`);
  await page.getByRole("button", { name: BTN }).click();
  expect(await scrollsSideways(page)).toBe(false);
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Yes, I picked them up" }).click();
  await expect(page.getByTestId("picked-up")).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
  await expectNoAxeViolations(page);
});

test("chef: sees the confirmation and cannot mark the pickup missed", async ({
  page,
}) => {
  await loginChef(page);
  await setMockHooks(page, { pickedUpSeeded: [SEEDED.A05] });
  await openPage(page, `/chef/bookings/${SEEDED.A05}`);
  await expect(page.getByTestId("loading")).toHaveCount(0);
  await expect(page.getByTestId("picked-up")).toContainText(
    "Picked up (confirmed by the customer) on",
  );
  await expect(page.getByTestId("missed-pickup")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Mark pickup missed" }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 800 });
  expect(await scrollsSideways(page)).toBe(false);
  await expectNoAxeViolations(page);
});

test("chef: an unconfirmed past-deadline day still allows 'pickup missed' (control)", async ({
  page,
}) => {
  await loginChef(page);
  await openPage(page, `/chef/bookings/${SEEDED.A05}`);
  await expect(page.getByTestId("picked-up")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Mark pickup missed" }),
  ).toBeVisible();
});
