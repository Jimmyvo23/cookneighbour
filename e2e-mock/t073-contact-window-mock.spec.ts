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

// T-073, MOCK mode: the D-52 contact window on both booking pages, the customer's Cancel button
// when every visit is past, and the plural mark-cooked wording. Dates are relative to the Toronto
// calendar day (dayPlus). All data is made up.
let storageTried: string[];
test.beforeEach(async ({ page }) => {
  storageTried = await blockAllStorage(page);
});
test.afterEach(() => {
  expect(storageTried).toEqual([]);
});

/** Moves both days of the seeded booking 9104 to `d1` and `d2` (both sides' copies), uncooked. */
async function moveDays(
  page: Page,
  key: "bookings" | "chefBookings",
  d1: string,
  d2: string,
) {
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
    { key, d1, d2 },
  );
}

test("customer: an accepted booking explains the window, shows the cut-off, and offers Cancel", async ({
  page,
}) => {
  await loginCustomer(page);
  await seedCustomerBookings(page);
  await moveDays(page, "bookings", dayPlus(1), dayPlus(2));
  await openPage(page, `/bookings/${SEEDED.A04}`);
  const note = page.getByTestId("contact-window");
  await expect(note).toContainText("Visible until");
  await expect(note).toContainText("Toronto time");
  await expect(note).toContainText("hidden 7 days after the last visit day");
  await expect(note).toContainText("Chat stays open.");
  await expect(
    page.getByRole("button", { name: "Cancel this booking" }),
  ).toBeVisible();
  await expectNoAxeViolations(page);
});

test("customer: after the cut-off the page says contact details are hidden now, and Cancel is gone", async ({
  page,
}) => {
  await loginCustomer(page);
  await seedCustomerBookings(page);
  await moveDays(page, "bookings", dayPlus(-12), dayPlus(-10));
  await openPage(page, `/bookings/${SEEDED.A04}`);
  await expect(page.getByTestId("contact-later")).toContainText(
    "Contact details are hidden now",
  );
  await expect(page.getByTestId("contact")).toHaveCount(0);
  await expect(page.getByTestId("contact-window")).toHaveCount(0);
  // The customer's own cooking address stays (customer's home booking).
  await expect(page.getByTestId("cooking-place")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel this booking" }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await scrollsSideways(page)).toBe(false);
  await expectNoAxeViolations(page);
});

test("customer: Cancel is hidden when every visit day has passed, but the booking is still there", async ({
  page,
}) => {
  await loginCustomer(page);
  await seedCustomerBookings(page);
  await moveDays(page, "bookings", dayPlus(-2), dayPlus(-1));
  await openPage(page, `/bookings/${SEEDED.A04}`);
  await expect(page.getByTestId("waiting-check")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel this booking" }),
  ).toHaveCount(0);
  // Still inside the window: the contact is shown with its cut-off.
  await expect(page.getByTestId("contact-window")).toContainText(
    "Visible until",
  );
});

test("chef: contact window text, hidden-now text, and 'Mark them as cooked' for several days", async ({
  page,
}) => {
  await loginChef(page);
  await openPage(page, "/chef/bookings");
  await expect(page.getByTestId("booking-item").first()).toBeVisible();

  await moveDays(page, "chefBookings", dayPlus(-3), dayPlus(-2));
  await openPage(page, `/chef/bookings/${SEEDED.A04}`);
  await expect(page.getByTestId("contact-window")).toContainText(
    "Visible until",
  );
  await expect(page.getByTestId("mark-cooked-prompt")).toContainText(
    "Mark them as cooked",
  );

  await moveDays(page, "chefBookings", dayPlus(-12), dayPlus(-10));
  await openPage(page, `/chef/bookings/${SEEDED.A04}`);
  await expect(page.getByTestId("contact-later")).toContainText(
    "Contact details are hidden now",
  );
  await expect(page.getByTestId("address-later")).toContainText("hidden now");
  await expectNoAxeViolations(page);
});
