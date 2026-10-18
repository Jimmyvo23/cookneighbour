import { expect, test } from "@playwright/test";
import {
  SEEDED,
  blockAllStorage,
  expectNoAxeViolations,
  loginCustomer,
  openPage,
  setMockHooks,
} from "./helpers";

// T-081 (D-81, D-83), MOCK mode: confirming the pickup of the only (cooked) day completes the
// booking at once; the page keeps the "Picked up on" line and shows the completed status.
let storageTried: string[];
test.beforeEach(async ({ page }) => {
  storageTried = await blockAllStorage(page);
});
test.afterEach(() => {
  expect(storageTried).toEqual([]);
});

test("customer: the last confirmed pickup completes the booking and the page still reads sensibly", async ({
  page,
}) => {
  await loginCustomer(page);
  await setMockHooks(page, { seedCustomer: true });
  await openPage(page, `/bookings/${SEEDED.A05}`);
  await expect(page.getByTestId("loading")).toHaveCount(0);
  await page.getByRole("button", { name: "I picked up my meals" }).click();
  await page.getByRole("button", { name: "Yes, I picked them up" }).click();
  await expect(page.getByTestId("picked-up")).toContainText("Picked up on");
  await expect(page.getByTestId("status")).toContainText(/completed/i);
  await expect(
    page.getByRole("button", { name: "I picked up my meals" }),
  ).toHaveCount(0);
  await expectNoAxeViolations(page);
  // After a reload the completed booking is still shown.
  await page.reload();
  await expect(page.getByTestId("status")).toContainText(/completed/i);
  await expect(page.getByTestId("picked-up")).toContainText("Picked up on");
});
