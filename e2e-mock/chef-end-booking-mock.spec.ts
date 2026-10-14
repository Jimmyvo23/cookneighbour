import { expect, test, type Page } from "@playwright/test";
import {
  SEEDED,
  blockAllStorage,
  editMockState,
  expectNoAxeViolations,
  loginChef,
  loginCustomer,
  openPage,
  scrollsSideways,
  seedCustomerBookings,
  vis,
} from "./helpers";

// T-070, MOCK mode: the chef cancels an accepted booking or reports a customer no-show
// (src/lib/mocks/mock-booking-changes.ts, contract 7A). The bookings are made up, dates are
// relative to today, nothing is stored outside this browser tab and no money moves.
let storageTried: string[];

test.beforeEach(async ({ page }) => {
  storageTried = await blockAllStorage(page);
});
test.afterEach(() => {
  expect(storageTried).toEqual([]);
});

async function openBooking(page: Page, id: string) {
  await openPage(page, `/chef/bookings/${id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Booking from",
  );
  await expect(page.getByTestId("loading")).toHaveCount(0);
}

test.describe("chef cancels an accepted booking", () => {
  test.beforeEach(async ({ page }) => loginChef(page));

  test("a late cancellation: confirm step, contact details refused on the field, then done", async ({
    page,
  }) => {
    await openBooking(page, SEEDED.A04); // day 1 is today: inside 48 hours
    await page.getByRole("button", { name: "Cancel this booking" }).click();
    await expect(
      page.getByRole("heading", { name: "Cancel this booking?" }),
    ).toBeFocused();
    await expect(page.getByTestId("cancel-timing-note")).toContainText(
      "late cancellation",
    );
    await expectNoAxeViolations(page);

    const reason = page.getByLabel("Reason (optional)");
    await reason.fill("call me on 416 555 0199");
    await page
      .getByRole("button", { name: "Yes, cancel this booking" })
      .click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "phone numbers, emails and links" }),
    ).toBeVisible();
    await expect(reason).toBeFocused();
    await expect(reason).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByTestId("status")).toContainText("You accepted");

    await reason.fill("I am ill this week");
    await page
      .getByRole("button", { name: "Yes, cancel this booking" })
      .click();
    await expect(page.getByTestId("status")).toContainText("Cancelled");
    await expect(page.getByTestId("notice")).toBeFocused();
    await expect(page.getByTestId("cancelled")).toContainText(
      "You cancelled this booking. Reason: I am ill this week",
    );
    await expect(page.getByTestId("cancelled")).toContainText("48 hours");
    await expect(page.getByTestId("end-booking")).toHaveCount(0);
    await page.goto("/chef/bookings");
    await expect(page.getByTestId("group-upcoming")).toContainText(
      "Accepted (3)",
    );
  });

  test("an on-time cancellation of a free first booking says the customer keeps it", async ({
    page,
  }) => {
    await openBooking(page, SEEDED.A01); // requested, free first booking, first day in 3 days
    await page.getByRole("button", { name: "Accept this request" }).click();
    await expect(page.getByTestId("status")).toContainText("You accepted");
    await page.getByRole("button", { name: "Cancel this booking" }).click();
    await expect(page.getByTestId("cancel-timing-note")).toContainText(
      "on-time cancellation",
    );
    await expect(page.getByTestId("cancel-trial-note")).toContainText(
      "keeps their free first booking",
    );
    await page
      .getByRole("button", { name: "Yes, cancel this booking" })
      .click();
    await expect(page.getByTestId("cancelled")).toContainText(
      "keeps their free first booking",
    );
  });

  test("works with the keyboard and 'Keep the booking' returns focus", async ({
    page,
  }) => {
    await openBooking(page, SEEDED.A04);
    const open = page.getByRole("button", { name: "Cancel this booking" });
    await open.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Cancel this booking?" }),
    ).toBeFocused();
    await page.getByRole("button", { name: "Keep the booking" }).focus();
    await page.keyboard.press("Enter");
    await expect(open).toBeFocused();
    await open.press("Enter");
    await page.getByLabel("Reason (optional)").focus();
    await page.keyboard.type("Family emergency");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Yes, cancel this booking" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("status")).toContainText("Cancelled");
  });

  test("with nothing left to cancel it explains instead of offering a button", async ({
    page,
  }) => {
    await openBooking(page, SEEDED.A03); // its only visit was yesterday and is cooked
    await expect(page.getByTestId("cancel-unavailable")).toContainText(
      "nothing left to cancel",
    );
    await expect(
      page.getByRole("button", { name: "Cancel this booking" }),
    ).toHaveCount(0);
  });

  test("a stale page: a booking cancelled elsewhere is refused in words and focus goes to the alert", async ({
    page,
  }) => {
    await openBooking(page, SEEDED.A04);
    await page.getByRole("button", { name: "Cancel this booking" }).click();
    await editMockState(page, (st) => {
      for (const r of st.chefBookings)
        if (r.detail.id.endsWith("9104")) r.detail.status = "completed";
    });
    await page
      .getByRole("button", { name: "Yes, cancel this booking" })
      .click();
    const alert = page.getByRole("alert").filter({ hasText: "not accepted" });
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
  });
});

test.describe("chef reports a customer no-show", () => {
  test.beforeEach(async ({ page }) => loginChef(page));

  test("is offered for a visit due today, asks first, and closes the booking", async ({
    page,
  }) => {
    await openBooking(page, SEEDED.A04);
    await page
      .getByRole("button", { name: "Report a customer no-show" })
      .click();
    await expect(
      page.getByRole("heading", { name: /did not show up for day 1/ }),
    ).toBeFocused();
    await expect(page.getByTestId("report-no-show")).toContainText(
      "You cannot undo it",
    );
    await expectNoAxeViolations(page);
    await page.getByRole("button", { name: "Keep the booking" }).click();
    await expect(
      page.getByRole("button", { name: "Report a customer no-show" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Yes, report a no-show" }).click();
    await expect(page.getByTestId("status")).toContainText("customer no-show");
    await expect(page.getByTestId("notice")).toBeFocused();
    await expect(page.getByTestId("no-show")).toContainText(
      "You reported a customer no-show",
    );
    await expect(page.getByTestId("end-booking")).toHaveCount(0);
  });

  test("a free first booking says the customer's trial counts as used", async ({
    page,
  }) => {
    await openBooking(page, SEEDED.A01);
    await page.getByRole("button", { name: "Accept this request" }).click();
    await expect(page.getByTestId("status")).toContainText("You accepted");
    // Day 1 is in three days: not due yet.
    await expect(page.getByTestId("no-show-unavailable")).toContainText(
      "from the day of a visit",
    );
    await editMockState(page, (st) => {
      for (const r of st.chefBookings)
        if (r.detail.id.endsWith("9101"))
          r.detail.days[0].date = new Date().toISOString().slice(0, 10);
    });
    await page.reload();
    await page
      .getByRole("button", { name: "Report a customer no-show" })
      .click();
    await expect(page.getByTestId("no-show-trial-note")).toContainText(
      "counts as used",
    );
  });

  test("a visit that is cooked cannot be reported", async ({ page }) => {
    await openBooking(page, SEEDED.A03);
    await expect(page.getByTestId("no-show-unavailable")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Report a customer no-show" }),
    ).toHaveCount(0);
  });
});

test.describe("wording after the booking ended (chef)", () => {
  test.beforeEach(async ({ page }) => loginChef(page));

  test("a finished chef's-home booking no longer locks the kitchen address", async ({
    page,
  }) => {
    await openPage(page, "/chef/bookings");
    await expect(page.getByTestId("booking-item").first()).toBeVisible();
    await editMockState(page, (st) => {
      for (const r of st.chefBookings)
        if (r.detail.id.endsWith("9103")) r.detail.status = "completed";
    });
    await openBooking(page, SEEDED.A03);
    await expect(page.getByTestId("kitchen-note")).toContainText(
      "This booking no longer locks your kitchen address",
    );
    await expect(page.getByTestId("kitchen-note")).not.toContainText(
      "no longer locked",
    );
  });
});

test.describe("small screens and dark mode", () => {
  test.beforeEach(async ({ page }) => loginChef(page));

  test("375 px: both confirm steps open, no sideways scroll, axe clean", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openBooking(page, SEEDED.A04);
    await page.getByRole("button", { name: "Cancel this booking" }).click();
    await page
      .getByRole("button", { name: "Report a customer no-show" })
      .click();
    expect(await scrollsSideways(page)).toBe(false);
    await expectNoAxeViolations(page);
    await page
      .getByRole("button", { name: "Yes, cancel this booking" })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "Yes, cancel this booking" }),
    ).toBeVisible();
  });

  test("dark mode: both confirm steps are axe clean", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openBooking(page, SEEDED.A04);
    await page.getByRole("button", { name: "Cancel this booking" }).click();
    await page
      .getByRole("button", { name: "Report a customer no-show" })
      .click();
    await expectNoAxeViolations(page);
  });
});

test.describe("customer wording when a booking never reached acceptance", () => {
  test("a declined booking says contact details are not shown, not 'once the chef accepts'", async ({
    page,
  }) => {
    await loginCustomer(page);
    await seedCustomerBookings(page);
    await editMockState(page, (st) => {
      for (const r of st.bookings)
        if (r.detail.id.endsWith("9102")) r.detail.status = "declined";
    });
    await openPage(page, `/bookings/${SEEDED.A02}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Booking with",
    );
    await expect(vis(page, "kitchen-later")).toContainText(
      "not shown for this booking",
    );
    await expect(vis(page, "contact-later")).toContainText(
      "not shown for this booking",
    );
    const text = await page.getByRole("main").innerText();
    expect(text).not.toMatch(/once the chef accepts|only after the chef/);
    await expectNoAxeViolations(page);
  });

  test("a waiting request still says they are shared once the chef accepts", async ({
    page,
  }) => {
    await loginCustomer(page);
    await seedCustomerBookings(page);
    await openPage(page, `/bookings/${SEEDED.A02}`);
    await expect(vis(page, "kitchen-later")).toContainText(
      "once the chef accepts",
    );
    await expect(vis(page, "contact-later")).toContainText(
      "after the chef accepts",
    );
  });
});
