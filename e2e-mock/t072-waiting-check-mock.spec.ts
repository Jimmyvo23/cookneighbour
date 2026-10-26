import { expect, test, type Page } from "@playwright/test";
import {
  SEEDED,
  blockAllStorage,
  dayPlus,
  editMockState,
  expectNoAxeViolations,
  loginChef,
  loginCustomer,
  openPage,
  scrollsSideways,
  seedCustomerBookings,
} from "./helpers";

// T-072, MOCK mode: an accepted booking whose visit days are all past and none cooked is
// "waiting for a check" for both sides, and the chef is asked to mark past days as cooked.
// Dates are relative to the Toronto calendar day. All data is made up.
let storageTried: string[];
test.beforeEach(async ({ page }) => {
  storageTried = await blockAllStorage(page);
});
test.afterEach(() => {
  expect(storageTried).toEqual([]);
});

/** Moves the two days of the seeded booking 9104 to the past, uncooked (both sides' copies). */
async function makeAllPast(page: Page, key: "bookings" | "chefBookings") {
  await editMockState(
    page,
    (st, a: { key: string; d1: string; d2: string }) => {
      for (const r of st[a.key])
        if (r.detail.id.endsWith("9104")) {
          r.detail.days[0].date = a.d1;
          r.detail.days[1].date = a.d2;
          for (const d of r.detail.days) d.cookedAt = null;
        }
    },
    { key, d1: dayPlus(-2), d2: dayPlus(-1) },
  );
}

test("chef: prompt to mark past days, then marking one clears the waiting state", async ({
  page,
}) => {
  await loginChef(page);
  await openPage(page, "/chef/bookings");
  await expect(page.getByTestId("booking-item").first()).toBeVisible();
  await makeAllPast(page, "chefBookings");

  await page.goto("/chef/bookings");
  const row = page.getByTestId("booking-item").filter({ hasText: "Omar" });
  await expect(row).toContainText("All visit days have passed");

  await openPage(page, `/chef/bookings/${SEEDED.A04}`);
  const prompt = page.getByTestId("mark-cooked-prompt");
  await expect(prompt).toContainText("Days 1 and 2 have passed");
  await expect(page.getByTestId("waiting-check")).toContainText(
    "waiting for a check",
  );
  await expectNoAxeViolations(page);

  // Keyboard only: focus the button and press Enter.
  const mark = page.getByRole("button", { name: "Mark day 1 as cooked" });
  await mark.focus();
  await page.keyboard.press("Enter");
  await expect(prompt).toContainText("Day 2 has passed");
  await expect(page.getByTestId("waiting-check")).toHaveCount(0);
});

test("chef: the prompt fits at 375 px and in dark mode", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.emulateMedia({ colorScheme: "dark" });
  await loginChef(page);
  await openPage(page, "/chef/bookings");
  await expect(page.getByTestId("booking-item").first()).toBeVisible();
  await makeAllPast(page, "chefBookings");
  await openPage(page, `/chef/bookings/${SEEDED.A04}`);
  await expect(page.getByTestId("mark-cooked-prompt")).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
  await expectNoAxeViolations(page);
});

test("customer: neutral 'waiting for a check', also at 375 px and in dark mode", async ({
  page,
}) => {
  await loginCustomer(page);
  await seedCustomerBookings(page);
  await makeAllPast(page, "bookings");

  await page.goto("/bookings");
  await expect(page.getByTestId("booking-item").first()).toBeVisible();
  await expect(
    page
      .getByTestId("booking-item")
      .filter({ has: page.locator(`a[href$="${SEEDED.A04}"]`) }),
  ).toContainText("All visit days have passed");

  await openPage(page, `/bookings/${SEEDED.A04}`);
  const note = page.getByTestId("waiting-check");
  await expect(note).toContainText("waiting for a check");
  await expectNoAxeViolations(page);

  await page.setViewportSize({ width: 375, height: 800 });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(note).toBeVisible();
  // T-126 v2: the button text flips to dark ink at once while the 160 ms background transition is
  // still fading to the light clay, so axe measured a half-way colour. Let the transitions end first.
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished)),
  );
  expect(await scrollsSideways(page)).toBe(false);
  await expectNoAxeViolations(page);
});

test("customer: an upcoming accepted booking is not shown as waiting", async ({
  page,
}) => {
  await loginCustomer(page);
  await seedCustomerBookings(page);
  await openPage(page, `/bookings/${SEEDED.A04}`);
  await expect(page.getByTestId("status")).toContainText("Accepted");
  await expect(page.getByTestId("waiting-check")).toHaveCount(0);
});
