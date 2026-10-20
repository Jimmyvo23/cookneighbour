import { expect, test, type Page } from "@playwright/test";
import {
  PNG,
  SEEDED,
  blockAllStorage,
  editMockState,
  expectNoAxeViolations,
  loginCustomer,
  openPage,
  scrollsSideways,
  seedCustomerBookings,
} from "./helpers";

// T-049 Tester, MOCK mode, 375 px: the review form, the window, the report button and the public
// review list, on the made-up bookings of the MOCK adapter. Nothing is stored outside the tab.
test.use({ viewport: { width: 375, height: 800 } });

const MAI = "00000000-0000-4000-8000-000000001001";
let storageTried: string[];

test.beforeEach(async ({ page }) => {
  storageTried = await blockAllStorage(page);
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: PNG.buffer }),
  );
});
test.afterEach(() => {
  expect(storageTried).toEqual([]);
});

/** Makes the seeded booking A04 a completed one, `daysAgo` days after it was completed. */
async function complete(page: Page, daysAgo: number) {
  await editMockState(
    page,
    (st, args: { id: string; daysAgo: number }) => {
      for (const r of st.bookings)
        if (r.detail.id === args.id) {
          r.detail.status = "completed";
          r.detail.completedAt = new Date(
            Date.now() - args.daysAgo * 86_400_000,
          ).toISOString();
        }
    },
    { id: SEEDED.A04, daysAgo },
  );
}
async function open(page: Page) {
  await openPage(page, `/bookings/${SEEDED.A04}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Booking with",
  );
  await expect(page.getByTestId("loading")).toHaveCount(0);
}
const section = (page: Page, id: string) =>
  page.getByTestId(id).filter({ visible: true });

test("review: the form is refused with focus on the rating, contact details are refused under the comment, then the review is final", async ({
  page,
}) => {
  await loginCustomer(page);
  await seedCustomerBookings(page);
  await complete(page, 1);
  await open(page);

  const reviews = section(page, "reviews");
  await expect(reviews.getByTestId("reviews-mock")).toContainText("MOCK");
  await expect(reviews.getByTestId("review-window")).toContainText("14 days");
  await expect(reviews.getByTestId("review-final")).toContainText("final");
  expect(await scrollsSideways(page)).toBe(false);
  await expectNoAxeViolations(page);

  // Nothing chosen: refused, focus on the rating group.
  await reviews.getByRole("button", { name: "Post review" }).click();
  await expect(reviews.getByRole("alert")).toContainText("highlighted");
  await expect(reviews.locator("fieldset")).toBeFocused();
  await expectNoAxeViolations(page);

  // Keyboard: arrow keys move the rating.
  await reviews.getByRole("radio", { name: /^3/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(reviews.getByRole("radio", { name: /^4/ })).toBeChecked();

  // A public comment with a phone number is refused by the field, text kept.
  const comment = reviews.getByLabel("Comment (optional)");
  await comment.fill("Great! Call me on 416-555-0101");
  await reviews.getByRole("button", { name: "Post review" }).click();
  await expect(comment).toBeFocused();
  await expect(comment).toHaveAttribute("aria-invalid", "true");
  await expect(comment).toHaveValue("Great! Call me on 416-555-0101");

  await comment.fill("Lovely food, thank you.");
  await reviews.getByRole("button", { name: "Post review" }).click();
  await expect(section(page, "review-posted")).toBeFocused();
  await expect(section(page, "review-posted")).toContainText("final");
  await expect(reviews.getByTestId("review-form")).toHaveCount(0);
  await expect(reviews.getByTestId("my-review")).toContainText(
    "Lovely food, thank you.",
  );
  expect(await scrollsSideways(page)).toBe(false);
  await expectNoAxeViolations(page);

  // Still final after a reload of the page (same tab state).
  await open(page);
  await expect(section(page, "reviews").getByTestId("my-review")).toBeVisible();
  await expect(section(page, "reviews").getByTestId("review-form")).toHaveCount(
    0,
  );
});

test("review: 14 days after completion the window is closed and there is no form", async ({
  page,
}) => {
  await loginCustomer(page);
  await seedCustomerBookings(page);
  await complete(page, 15);
  await open(page);
  const reviews = section(page, "reviews");
  await expect(reviews.getByTestId("review-why")).toContainText(
    "time to write a review has ended",
  );
  await expect(reviews.getByTestId("review-form")).toHaveCount(0);
});

test("review: an accepted booking has no review section at all", async ({
  page,
}) => {
  await loginCustomer(page);
  await seedCustomerBookings(page);
  await open(page);
  await expect(section(page, "reviews")).toHaveCount(0);
  // ...but the report button is there on every booking.
  await expect(section(page, "report-button")).toBeVisible();
});

test("report: sent once, then its status replaces the form; the text says only you and an admin can read it", async ({
  page,
}) => {
  await loginCustomer(page);
  await seedCustomerBookings(page);
  await open(page);
  const reports = section(page, "reports");
  await expect(reports.getByTestId("reports-mock")).toContainText("MOCK");
  await expect(reports).toContainText(
    "Only you and an admin can read your report. The other person cannot see it.",
  );
  await reports.getByTestId("report-button").click();
  await expect(reports.getByRole("heading", { name: /Tell us/ })).toBeFocused();

  await reports.getByRole("button", { name: "Send report" }).click();
  await expect(reports.getByRole("alert")).toContainText("highlighted");
  await expect(reports.getByLabel("What is it about?")).toBeFocused();
  expect(await scrollsSideways(page)).toBe(false);
  await expectNoAxeViolations(page);

  await reports.getByLabel("What is it about?").selectOption("food_quality");
  await reports.getByLabel("What happened?").fill("The food was cold.");
  await reports.getByRole("button", { name: "Send report" }).click();
  await expect(section(page, "report-sent")).toBeFocused();
  await expect(reports.getByTestId("report-status")).toContainText(
    "Open: waiting for an admin",
  );
  await expect(reports.getByTestId("report-button")).toHaveCount(0);
  await expectNoAxeViolations(page);
});

test("public chef page: first names only, load more moves focus to the first new review", async ({
  page,
}) => {
  await page.goto(`/chefs/${MAI}`);
  const list = page.getByRole("list", { name: "Customer reviews" });
  await expect(list).toBeVisible();
  const items = list.getByTestId("public-review");
  const before = await items.count();
  expect(before).toBeGreaterThan(0);
  // A first name is one word.
  for (const t of await items.locator("p.font-semibold").allTextContents())
    expect(t.trim()).not.toMatch(/\s/);
  await expect(page.getByTestId("public-reviews")).not.toContainText(
    /patel|nguyen|customer reviews? from/i,
  );
  await page.getByRole("button", { name: "Show more reviews" }).click();
  await expect(items.nth(before)).toBeFocused();
  expect(await scrollsSideways(page)).toBe(false);
  await expectNoAxeViolations(page);
});
