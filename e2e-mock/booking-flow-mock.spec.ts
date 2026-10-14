import { expect, test, type Page } from "@playwright/test";
import {
  blockStorage,
  dayPlus,
  expectNoAxeViolations,
  setMockHooks,
  signUpCustomer,
} from "./helpers";

// T-043, MOCK mode: the booking flow against the mock adapter (src/lib/mocks/mock-bookings.ts).
// Every chef, dish and booking is made up and lives only in this browser tab. Nothing is charged.
// Mai Tran (...1001) cooks at the customer's home and at her own home; Linh (...1002) only at the
// customer's home; ...1050 is a chef who cannot be booked (404, D-25).
const MAI = "00000000-0000-4000-8000-000000001001";
const LINH = "00000000-0000-4000-8000-000000001002";
const NADIA = "00000000-0000-4000-8000-000000001050";

test.beforeEach(async ({ page }) => {
  await blockStorage(page);
});

async function hideOverlay(page: Page) {
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
}

async function openBooking(page: Page, id = MAI) {
  await page.goto(`/chefs/${id}/book`);
  await hideOverlay(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

interface FillOptions {
  /** Days from today for each booking day. */
  offsets?: number[];
  /** Dish names per day. */
  dishes?: string[][];
  chefHome?: boolean;
  groceries?: "customer_buys" | "chef_shops";
  postal?: string;
  trial?: boolean;
}

/** Fills the whole form with valid answers (no allergies, no dietary needs). */
async function fillForm(page: Page, o: FillOptions = {}) {
  const offsets = o.offsets ?? [5];
  const dishes = o.dishes ?? offsets.map(() => ["Pho bo"]);
  await page.getByLabel("How many days?").selectOption(String(offsets.length));
  for (let i = 0; i < offsets.length; i++) {
    await page
      .getByLabel(`Date for day ${i + 1}`)
      .selectOption(dayPlus(offsets[i]));
    for (const name of dishes[i])
      await page
        .getByRole("checkbox", { name: `${name} on day ${i + 1}` })
        .check();
  }
  if (o.chefHome)
    await page.getByRole("radio", { name: "At the chef's home" }).check();
  else {
    await page.getByRole("radio", { name: "At your home" }).check();
    if (o.postal) await page.getByLabel("Postal code").fill(o.postal);
  }
  await page
    .getByRole("radio", {
      name:
        (o.groceries ?? "customer_buys") === "customer_buys"
          ? "I buy the ingredients"
          : "The chef shops",
    })
    .check();
  await page.getByRole("checkbox", { name: "I have no allergies" }).check();
  await page.getByRole("checkbox", { name: "I have no dietary needs" }).check();
  if (o.trial === false)
    await page
      .getByRole("checkbox", { name: "Use my free first booking" })
      .uncheck();
}

async function toReview(page: Page) {
  await page.getByRole("button", { name: "Review my request" }).click();
  await expect(page.getByTestId("review-heading")).toBeVisible();
}

/** Books one day at full price and lands on the booking page. */
async function bookOne(page: Page, offset: number, trial = false) {
  await openBooking(page);
  await fillForm(page, { offsets: [offset], trial });
  await toReview(page);
  await page.getByRole("button", { name: "Send booking request" }).click();
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("status")).toBeVisible();
}

const noOverflow = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

test("happy path: a 2-day free-trial booking at the customer's home (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await page.goto(`/chefs/${MAI}`);
  await page.getByTestId("book-link").click();
  await expect(page).toHaveURL(new RegExp(`/chefs/${MAI}/book$`));
  await hideOverlay(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "Book Mai Tran (MOCK)" }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Book Mai Tran (MOCK) — CookNeighbour");
  await expect(page.getByText("Step 1 of 2")).toBeVisible();

  // The cooking address starts from the saved home address; the customer may change it.
  await page.getByLabel("How many days?").selectOption("2");
  await page.getByRole("radio", { name: "At your home" }).check();
  await expect(page.getByLabel("Street address")).toHaveValue("1 Main St");
  await expect(page.getByLabel("City")).toHaveValue("Mississauga");
  await expect(page.getByLabel("Postal code")).toHaveValue("L5B1M2");
  await expectNoAxeViolations(page);

  await fillForm(page, {
    offsets: [5, 6],
    dishes: [["Pho bo"], ["Goi cuon (fresh rolls)"]],
    postal: "L5N 1A1",
  });
  // Day totals come from the dishes.
  await expect(page.getByTestId("day-total").first()).toContainText("3 h");
  await expect(page.getByTestId("day-total").nth(1)).toContainText("1 h");
  await expect(page.getByTestId("visit-limit")).toHaveCount(0);
  await expectNoAxeViolations(page);

  await toReview(page);
  await expect(page.getByText("Step 2 of 2")).toBeVisible();
  await expect(page.getByTestId("review-heading")).toBeFocused();
  const est = page.getByTestId("estimate");
  await expect(est).toContainText(/Total cooking time.*4 h/);
  await expect(est).toContainText(
    "Labour before the free first booking$112.00",
  );
  await expect(est).toContainText(/Free first booking.*-\$112\.00/);
  await expect(est).toContainText("Labour you pay$0.00");
  await expect(est).toContainText(/Ingredients \(estimated\).*\$48\.00/);
  await expect(est).toContainText(
    /About [\d.]+ km one way at \$0\.60 per km, for 2 visits/,
  );
  await expect(est).not.toContainText(/Travel fee.*\$0\.00/);
  await expect(est).toContainText("Estimated total");
  // The platform fee is shown, labelled MOCK, never collected.
  await expect(page.getByTestId("platform-fee")).toContainText(
    "Shown only, not collected",
  );
  await expect(
    page.getByTestId("estimate-block").getByTestId("mock-badge"),
  ).toContainText("MOCK");
  await expect(page.getByTestId("trial-applied")).toBeVisible();
  // The MOCK payment step: nothing is charged.
  const pay = page.getByTestId("mock-payment");
  await expect(pay).toContainText("does not charge you");
  await expect(pay.getByTestId("mock-badge")).toBeVisible();
  await expect(page.getByTestId("expiry-note")).toContainText(
    "The chef has until",
  );
  await expect(page.getByTestId("late-warning")).toHaveCount(0);
  await expect(page.getByTestId("address-note")).toContainText(
    "only once they accept",
  );
  await expect(page.getByTestId("review-day")).toHaveCount(2);
  await expectNoAxeViolations(page);

  await page.getByRole("button", { name: "Send booking request" }).click();
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}\?sent=1$/);
  await expect(page.getByTestId("sent-banner")).toContainText(
    "Your request was sent to Mai Tran (MOCK). Nothing was charged.",
  );
  await expect(page.getByTestId("status")).toHaveText(
    /Waiting for the chef to answer/,
  );
  await expect(page.getByTestId("trial-label")).toContainText(
    "Free first booking",
  );
  await expect(page.getByTestId("expires")).toContainText("The chef has until");
  await expect(page.getByTestId("day")).toHaveCount(2);
  await expect(page.getByTestId("day").first()).toContainText("Pho bo");
  await expect(page.getByTestId("day").first()).toContainText("Eat by");
  // 6.8: no phone number before acceptance; the customer's own cooking address is theirs to see.
  await expect(page.getByTestId("contact-later")).toBeVisible();
  const text = await page.locator("main").filter({ visible: true }).innerText();
  expect(text).not.toMatch(/\+?1?\s?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  await expect(page.getByTestId("cooking-place")).toContainText("1 Main St");
  await expect(page.getByTestId("mock-payment")).toBeVisible();
  await expectNoAxeViolations(page);

  // It is in the list, and the list carries no address or phone.
  await page.getByRole("link", { name: "My bookings" }).first().click();
  await expect(page).toHaveURL(/\/bookings$/);
  const item = page.getByTestId("booking-item");
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("Mai Tran (MOCK)");
  await expect(item).toContainText("Free first booking");
  await expect(page.getByTestId("open-count")).toContainText("Waiting now: 1");
  await expectNoAxeViolations(page);
});

test("chef's home: the kitchen address is promised only after acceptance (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await openBooking(page);
  await fillForm(page, { chefHome: true, groceries: "chef_shops" });
  await expect(page.getByLabel("Street address")).toHaveCount(0);
  await expect(page.getByTestId("chef-home-note")).toContainText(
    "shared with you only once the chef accepts",
  );
  await toReview(page);
  const est = page.getByTestId("estimate");
  await expect(est).toContainText(/Travel fee.*\$0\.00/);
  await expect(est).toContainText(
    "None: you pick up the meals at the chef's home",
  );
  await expect(page.getByTestId("address-note")).toContainText(
    "kitchen address is shared with you only once the chef accepts",
  );
  await page.getByRole("button", { name: "Send booking request" }).click();
  await expect(page.getByTestId("kitchen-later")).toContainText(
    "shared with you once the chef accepts",
  );
  await expect(
    page.locator("main").filter({ visible: true }),
  ).not.toContainText("Kitchen Rd");
  await expect(page.getByTestId("cooking-place")).toHaveCount(0);

  // Once the booking is accepted (here the saved MOCK row is edited, because a chef cannot answer
  // in this mode) the kitchen and the chef's phone appear.
  await page.evaluate(() => {
    const key = "cookneighbour-mock-api-state";
    const s = JSON.parse(sessionStorage.getItem(key)!);
    s.bookings[0].detail.status = "accepted";
    sessionStorage.setItem(key, JSON.stringify(s));
  });
  await page.reload();
  await expect(page.getByTestId("status")).toHaveText(/Accepted by the chef/);
  await expect(page.getByTestId("cooking-place")).toContainText("Kitchen Rd");
  await expect(page.getByTestId("contact")).toContainText("+14165550100");
});

test("a chef who only cooks at the customer's home offers no chef's-home choice (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await openBooking(page, LINH);
  await expect(page.getByRole("radio", { name: "At your home" })).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "At the chef's home" }),
  ).toHaveCount(0);
});

test("an empty form lists every missing answer, focuses the summary and links to the fields (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await openBooking(page);
  // Keyboard only: focus the button and press Enter.
  await page.getByRole("button", { name: "Review my request" }).focus();
  await page.keyboard.press("Enter");
  const summary = page.getByTestId("error-summary");
  await expect(summary).toBeFocused();
  await expect(summary).toContainText("Choose a date for day 1.");
  await expect(summary).toContainText("Pick at least one dish for day 1.");
  await expect(summary).toContainText("Choose where the chef will cook.");
  await expect(summary).toContainText("Choose who buys the groceries.");
  await expect(summary).toContainText("Pick your allergies");
  await expect(summary).toContainText("Describe your dietary needs");
  await expectNoAxeViolations(page);

  // Tab into the first link, press Enter: the date field takes focus.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Date for day 1")).toBeFocused();
  await expect(page.getByLabel("Date for day 1")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  // The error text is tied to the field.
  await expect(page.getByLabel("Date for day 1")).toHaveAccessibleDescription(
    "Choose a date for day 1.",
  );
  // Fixing a field clears its message.
  await page.getByLabel("Date for day 1").selectOption(dayPlus(5));
  await expect(summary).not.toContainText("Choose a date for day 1.");
});

test("the 6 hour limit warns at once and blocks until dishes are removed (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await openBooking(page);
  await fillForm(page, { offsets: [5] });
  await page.getByLabel("Quantity of Pho bo, day 1").fill("3");
  const warn = page.getByTestId("visit-limit");
  await expect(warn).toContainText("Too long for one visit");
  await expect(warn).toContainText("9 h");
  await expect(warn).toContainText("3 h over the 6 hour limit");
  await expect(page.getByTestId("day-total")).toContainText("9 h");
  await expectNoAxeViolations(page);

  await page.getByRole("button", { name: "Review my request" }).click();
  await expect(page.getByTestId("error-summary")).toBeFocused();
  await expect(page.getByTestId("error-summary")).toContainText(
    "Remove dishes or move some to another day",
  );
  await expect(page.getByTestId("review-heading")).toHaveCount(0);

  // Exactly 6 hours is allowed.
  await page.getByLabel("Quantity of Pho bo, day 1").fill("2");
  await expect(warn).toHaveCount(0);
  await toReview(page);
});

test("an allergy that matches a dish must be acknowledged (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await openBooking(page);
  await fillForm(page, { offsets: [5] });
  // Pho bo contains soy; say soy is an allergy instead of "no allergies".
  await page.getByRole("checkbox", { name: "I have no allergies" }).uncheck();
  await page.getByRole("checkbox", { name: "Soy" }).check();
  const conflict = page.getByTestId("allergy-conflict");
  await expect(conflict).toContainText("Pho bo contains soy");
  await expectNoAxeViolations(page);

  await page.getByRole("button", { name: "Review my request" }).click();
  await expect(page.getByTestId("error-summary")).toBeFocused();
  await expect(page.getByTestId("error-summary")).toContainText(
    "Tick the box to confirm you understand",
  );
  await page
    .getByRole("checkbox", {
      name: "I understand and want to keep these dishes",
    })
    .check();
  await toReview(page);
  await expect(page.getByTestId("review-conflicts")).toContainText(
    "Pho bo (soy)",
  );

  await page.getByRole("button", { name: "Send booking request" }).click();
  await expect(page.getByTestId("conflicts")).toContainText("Pho bo");
  await expect(page.getByTestId("conflicts")).toContainText("you confirmed");
});

test("a text allergy is matched with synonyms and removing the dish clears the warning (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await openBooking(page);
  await fillForm(page, { offsets: [5], dishes: [["Goi cuon (fresh rolls)"]] });
  await page.getByRole("checkbox", { name: "I have no allergies" }).uncheck();
  await page
    .getByLabel("Other allergies or details (optional)")
    .first()
    .fill("shrimp");
  // Goi cuon lists "shellfish"; D-24 treats it as the same family.
  await expect(page.getByTestId("allergy-conflict")).toContainText("Goi cuon");
  await page
    .getByRole("checkbox", { name: "Goi cuon (fresh rolls) on day 1" })
    .uncheck();
  await expect(page.getByTestId("allergy-conflict")).toHaveCount(0);
});

test("the last-minute warning: day 1 less than 48 hours away is already a late cancellation (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await openBooking(page);
  await fillForm(page, { offsets: [1], trial: false });
  await toReview(page);
  const late = page.getByTestId("late-warning");
  await expect(late).toContainText("less than 48 hours away");
  await expect(late).toContainText("late cancellation");
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Send booking request" }).click();
  await expect(page.getByTestId("status")).toBeVisible();

  // Cancel shows the late warning before the customer confirms (D-20).
  await page.getByRole("button", { name: "Cancel this booking" }).click();
  await expect(page.getByTestId("late-cancel-warning")).toContainText(
    "This will be a late cancellation",
  );
  await page.getByLabel("Reason (optional)").fill("Plans changed");
  await page.getByRole("button", { name: "Yes, cancel this booking" }).click();
  await expect(page.getByTestId("status")).toHaveText(/Cancelled/);
  await expect(page.getByTestId("cancel-timing")).toContainText(
    "late cancellation",
  );
  await expect(page.getByTestId("cancelled")).toContainText(
    "Reason: Plans changed",
  );
  await expect(
    page.getByRole("button", { name: "Cancel this booking" }),
  ).toHaveCount(0);
});

test("an on-time cancel keeps the free first booking (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await bookOne(page, 7, true);
  await page.getByRole("button", { name: "Cancel this booking" }).click();
  await expect(page.getByTestId("free-cancel-note")).toBeVisible();
  await expect(page.getByTestId("late-cancel-warning")).toHaveCount(0);
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Yes, cancel this booking" }).click();
  await expect(page.getByTestId("cancel-timing")).toContainText("on-time");
  await expect(page.getByTestId("trial-after-cancel")).toContainText(
    "not used up",
  );
});

test("contact details in a cancel reason are refused and focus goes to the field (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await bookOne(page, 7);
  await page.getByRole("button", { name: "Cancel this booking" }).click();
  await page.getByLabel("Reason (optional)").fill("Call me on 416 555 0100");
  await page.getByRole("button", { name: "Yes, cancel this booking" }).click();
  await expect(page.getByTestId("cancel-error")).toContainText(
    "leave phone numbers, emails and links out",
  );
  await expect(page.getByLabel("Reason (optional)")).toBeFocused();
  await expect(
    page.getByLabel("Reason (optional)"),
  ).toHaveAccessibleDescription(/Remove the contact details/);
  await expect(page.getByTestId("status")).toHaveText(/Waiting for the chef/);
  await expectNoAxeViolations(page);
});

test("a second booking cannot use the free trial; full price is shown with the reason (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await bookOne(page, 7, true);
  await openBooking(page);
  await fillForm(page, { offsets: [9] });
  await toReview(page);
  await expect(page.getByTestId("trial-blocked")).toContainText(
    "not available for this account",
  );
  await expect(page.getByTestId("estimate")).toContainText(/Labour.*\$84\.00/);
  await expect(page.getByTestId("trial-applied")).toHaveCount(0);
  await page.getByRole("button", { name: "Send booking request" }).click();
  await expect(page.getByTestId("trial-label")).toHaveCount(0);
});

test("a lost free-trial race offers the full-price booking after showing the new estimate (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await openBooking(page);
  await fillForm(page, { offsets: [5] });
  await toReview(page);
  await expect(page.getByTestId("trial-applied")).toBeVisible();
  await setMockHooks(page, { trialRaceOnce: true });
  await page.getByRole("button", { name: "Send booking request" }).click();
  const alert = page.getByTestId("flow-alert");
  await expect(alert).toBeFocused();
  await expect(alert).toContainText(
    "free first booking is not available any more",
  );
  await expect(alert).toContainText("nothing was sent");
  await expectNoAxeViolations(page);

  await alert
    .getByRole("button", { name: "Book at full price instead" })
    .click();
  await expect(page.getByTestId("estimate")).toContainText(/Labour.*\$84\.00/);
  await expect(page.getByTestId("trial-applied")).toHaveCount(0);
  await expect(page.getByTestId("flow-alert")).toContainText("full price");
  // One owner moves focus: the alert keeps it, the review heading does not steal it.
  await expect(page.getByTestId("flow-alert")).toBeFocused();
  await page.getByRole("button", { name: "Send booking request" }).click();
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}\?sent=1$/);
  await expect(page.getByTestId("trial-label")).toHaveCount(0);
});

test("a date taken while the customer reviews sends them back to pick another (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await openBooking(page);
  await fillForm(page, { offsets: [5] });
  await toReview(page);
  // Another customer books the chef on that day; this page still lists it.
  await setMockHooks(page, { otherBooked: { [MAI]: [dayPlus(5)] } });
  await page.getByRole("button", { name: "Send booking request" }).click();
  await expect(page.getByTestId("flow-alert")).toBeFocused();
  await expect(page.getByTestId("flow-alert")).toContainText(
    "booked on one of those days",
  );
  await expect(page.getByTestId("error-summary")).toContainText(
    "already booked on that date",
  );
  await expect(page.getByText("Step 1 of 2")).toBeVisible();
  await expectNoAxeViolations(page);
  // Fixing it: pick another date and go on.
  await page.getByLabel("Date for day 1").selectOption(dayPlus(8));
  await toReview(page);
});

test("a date that is already taken when the estimate runs is marked on its day (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await openBooking(page);
  await fillForm(page, { offsets: [5, 6] });
  await setMockHooks(page, { otherBooked: { [MAI]: [dayPlus(6)] } });
  await page.getByRole("button", { name: "Review my request" }).click();
  await expect(page.getByTestId("error-summary")).toBeFocused();
  await expect(page.getByLabel("Date for day 2")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.getByLabel("Date for day 1")).not.toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

test("the review shows an estimate for each day (MOCK, D-39)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await openBooking(page);
  await fillForm(page, {
    offsets: [5, 6],
    dishes: [["Pho bo"], ["Goi cuon (fresh rolls)"]],
    trial: false,
  });
  await toReview(page);
  const rows = page.getByTestId("per-day-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Day 1");
  await expect(rows.nth(0)).toContainText("3 h");
  await expect(rows.nth(1)).toContainText("Day 2");
  await expect(rows.nth(1)).toContainText("1 h");
  await expect(rows.nth(0)).toContainText(/Labour/);
  await expect(rows.nth(0)).toContainText(/Ingredients \(estimated\)/);
  await expect(page.getByTestId("estimate")).toContainText("Estimated total");
  await expectNoAxeViolations(page);
});

test("a customer with 3 open requests is warned before the form (MOCK, D-40)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await bookOne(page, 7);
  await bookOne(page, 8);
  await openBooking(page);
  // Two open requests: no warning yet.
  await expect(page.getByLabel("How many days?")).toBeVisible();
  await expect(page.getByTestId("open-limit-warning")).toHaveCount(0);
  await fillForm(page, { offsets: [9], trial: false });
  await toReview(page);
  await page.getByRole("button", { name: "Send booking request" }).click();
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}/);

  await openBooking(page);
  const warn = page.getByTestId("open-limit-warning");
  await expect(warn).toContainText("3 requests waiting for an answer");
  await expect(warn).toContainText("up to 3");
  await expectNoAxeViolations(page);
  await warn.getByRole("link", { name: "See your requests" }).click();
  await expect(page).toHaveURL(/\/bookings$/);
});

test("the review names the typed cooking address, not 'your home' (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await openBooking(page);
  await fillForm(page, { offsets: [5], trial: false });
  await page.getByLabel("Street address").fill("99 Other Rd");
  await toReview(page);
  await expect(page.getByTestId("review-heading")).toBeFocused();
  const where = page.getByText("At this address: 99 Other Rd, Mississauga");
  await expect(where).toBeVisible();
  await expect(page.getByText(/At your home \(/)).toHaveCount(0);
});

test("a fourth open request is refused with a way to the list (MOCK, D-28)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await bookOne(page, 7);
  await bookOne(page, 8);
  await bookOne(page, 9);
  await openBooking(page);
  await fillForm(page, { offsets: [11], trial: false });
  await toReview(page);
  await page.getByRole("button", { name: "Send booking request" }).click();
  const alert = page.getByTestId("flow-alert");
  await expect(alert).toBeFocused();
  await expect(alert).toContainText("3 requests waiting for an answer");
  await alert.getByRole("link", { name: "See your requests" }).click();
  await expect(page).toHaveURL(/\/bookings$/);
  await expect(page.getByTestId("booking-item")).toHaveCount(3);
  await expect(page.getByTestId("open-count")).toContainText("Waiting now: 3");
});

test("a phone that is not verified blocks sending and says why (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page, { verified: false });
  await openBooking(page);
  await fillForm(page, { offsets: [5], chefHome: true });
  await toReview(page);
  await expect(page.getByTestId("phone-blocked")).toContainText(
    "verified phone number",
  );
  await expect(page.getByTestId("trial-blocked")).toContainText("phone number");
  await expect(
    page.getByRole("button", { name: "Send booking request" }),
  ).toBeDisabled();
  await expectNoAxeViolations(page);
});

test("a chef who cannot be booked, or does not exist, is the same page (MOCK, D-25)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await page.goto(`/chefs/${NADIA}/book`);
  await expect(page.getByTestId("not-found")).toContainText(
    "This chef cannot be booked",
  );
  const first = await page.getByTestId("not-found").innerText();
  await page.goto(`/chefs/not-a-chef/book`);
  await expect(page.getByTestId("not-found")).toBeVisible();
  expect(await page.getByTestId("not-found").innerText()).toBe(first);
  await expectNoAxeViolations(page);
});

test("another customer's booking id is a plain not-found (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await page.goto("/bookings/00000000-0000-4000-8000-00000000abcd");
  await expect(page.getByTestId("not-found")).toContainText(
    "Booking not found",
  );
});

test("visitors are sent to log in and chefs are sent home (MOCK client layer)", async ({
  page,
}) => {
  await page.goto(`/chefs/${MAI}/book`);
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/bookings");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill("chef@example.com");
  await page.getByLabel("Password").fill("longenough1");
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto(`/chefs/${MAI}/book`);
  await expect(page).toHaveURL(/\/$/);
});

test("mobile: the form and the review fit a 375 px screen and the targets are large enough (MOCK)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signUpCustomer(page);
  await openBooking(page);
  expect(await noOverflow(page)).toBeLessThanOrEqual(0);
  await fillForm(page, {
    offsets: [5, 6, 7],
    dishes: [["Pho bo"], ["Bun cha"], ["Rau muong xao (stir-fried greens)"]],
  });
  expect(await noOverflow(page)).toBeLessThanOrEqual(0);
  for (const name of ["Review my request"]) {
    const box = await page.getByRole("button", { name }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await expectNoAxeViolations(page);
  await toReview(page);
  expect(await noOverflow(page)).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);
});

test("keyboard: the whole form can be filled and sent without a mouse (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await openBooking(page);
  const date = page.getByLabel("Date for day 1");
  await date.focus();
  await date.selectOption(dayPlus(6));
  await page
    .getByRole("checkbox", {
      name: "Rau muong xao (stir-fried greens) on day 1",
    })
    .focus();
  await page.keyboard.press("Space");
  await page.getByRole("radio", { name: "At your home" }).focus();
  await page.keyboard.press("Space");
  await page.getByRole("radio", { name: "I buy the ingredients" }).focus();
  await page.keyboard.press("Space");
  await page.getByRole("checkbox", { name: "I have no allergies" }).focus();
  await page.keyboard.press("Space");
  await page.getByRole("checkbox", { name: "I have no dietary needs" }).focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Review my request" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("review-heading")).toBeFocused();
  await page.getByRole("button", { name: "Send booking request" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}\?sent=1$/);
});

test("a second form in the same tab: labels and error links use the visible copy, and the sent form is closed (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await bookOne(page, 7);
  // Client-side navigation keeps earlier pages mounted but hidden; their ids must not clash.
  const go = (path: string) =>
    page.evaluate((u) => {
      (
        window as unknown as { next: { router: { push(u: string): void } } }
      ).next.router.push(u);
    }, path);
  await go(`/chefs/${LINH}/book`);
  await expect(page).toHaveURL(new RegExp(`/chefs/${LINH}/book$`));
  // The booking page stays mounted but hidden: no id may appear twice (section headings too).
  await expect(page.getByLabel("How many days?")).toBeVisible();
  const dupIds = await page.evaluate(() => {
    const seen = new Map<string, number>();
    document
      .querySelectorAll("[id]")
      .forEach((n) => seen.set(n.id, (seen.get(n.id) ?? 0) + 1));
    return [...seen].filter(([, c]) => c > 1).map(([id]) => id);
  });
  expect(dupIds).toEqual([]);
  const visible = page.locator("main").filter({ visible: true });
  await expect(visible.getByRole("heading", { level: 1 })).toHaveText(
    "Book Linh Nguyen (MOCK)",
  );
  await visible.locator("label", { hasText: "Date for day 1" }).click();
  await expect(visible.locator("select").nth(1)).toBeFocused();
  await visible.getByRole("button", { name: "Review my request" }).click();
  await visible.getByTestId("error-summary").getByRole("link").first().click();
  await expect(visible.locator("select").nth(1)).toBeFocused();
  await expectNoAxeViolations(page);

  // Going back to the first form shows that it was sent, not a stale review.
  await go(`/chefs/${MAI}/book`);
  await expect(visible.getByTestId("sent-panel")).toContainText(
    "Your request was sent. Nothing was charged.",
  );
  await visible.getByRole("button", { name: "Book another visit" }).click();
  await expect(visible.getByLabel("Date for day 1")).toBeVisible();
  await expect(visible.getByLabel("Date for day 1")).toHaveValue("");
});

test("dark mode: the form with errors, the allergy warning, the review and the booking are axe clean (MOCK)", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await signUpCustomer(page);
  await openBooking(page);
  await page.getByRole("button", { name: "Review my request" }).click();
  await expect(page.getByTestId("error-summary")).toBeVisible();
  await expectNoAxeViolations(page);
  await fillForm(page, { offsets: [1], dishes: [["Pho bo"]] });
  await page.getByRole("checkbox", { name: "I have no allergies" }).uncheck();
  await page.getByRole("checkbox", { name: "Soy" }).check();
  await page.getByLabel("Quantity of Pho bo, day 1").fill("3");
  await expect(page.getByTestId("allergy-conflict")).toBeVisible();
  await expect(page.getByTestId("visit-limit")).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByLabel("Quantity of Pho bo, day 1").fill("1");
  await page
    .getByRole("checkbox", {
      name: "I understand and want to keep these dishes",
    })
    .check();
  await toReview(page);
  await expect(page.getByTestId("late-warning")).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Send booking request" }).click();
  await expect(page.getByTestId("status")).toBeVisible();
  await page.getByRole("button", { name: "Cancel this booking" }).click();
  await expect(page.getByTestId("late-cancel-warning")).toBeVisible();
  await expectNoAxeViolations(page);
});
