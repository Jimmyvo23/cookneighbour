import { expect, test, type Page } from "@playwright/test";
import {
  blockStorage,
  dayPlus,
  expectNoAxeViolations,
  loginAdmin,
  signUpCustomer,
} from "./helpers";

// Tester (T-067 frontend), MOCK mode: paths the builder's spec does not reach. The failed
// profile save is made on demand with a test-only browser script (no app code): the first read of
// the MOCK state after the booking was created answers as if the signed-in user were a chef, so
// the PUT /api/me/intake that follows gets a 403 while the booking itself is already stored.
const MAI = "00000000-0000-4000-8000-000000001001";
const KEY = "cookneighbour-mock-api-state";

test.beforeEach(async ({ page }) => {
  await blockStorage(page);
});

async function hideOverlay(page: Page) {
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
}

async function fillRest(page: Page, day: number) {
  await page.getByLabel("Date for day 1").selectOption(dayPlus(day));
  await page.getByRole("checkbox", { name: "Pho bo on day 1" }).check();
  await page.getByRole("radio", { name: "At the chef's home" }).check();
  await page.getByRole("radio", { name: "I buy the ingredients" }).check();
}

async function sendBooking(page: Page) {
  await page.getByRole("button", { name: "Review my request" }).click();
  await expect(page.getByTestId("review-heading")).toBeVisible();
  await page.getByRole("button", { name: "Send booking request" }).click();
}

test("a failed profile save after booking keeps the booking and shows the notice (MOCK)", async ({
  page,
}) => {
  await page.addInitScript((key) => {
    const w = window as unknown as { __break?: boolean; __armed?: boolean };
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === key && this === window.sessionStorage) {
        try {
          // One shot (T-047): the chat's first read also writes the MOCK state, which armed this again.
          if (!w.__armed && (JSON.parse(v).bookings ?? []).length > 0)
            w.__break = w.__armed = true;
        } catch {
          /* ignore */
        }
      }
      return set.call(this, k, v);
    };
    Storage.prototype.getItem = function (k: string) {
      const raw = get.call(this, k);
      if (k === key && this === window.sessionStorage && w.__break && raw) {
        w.__break = false;
        const s = JSON.parse(raw);
        s.profile.role = "chef";
        return JSON.stringify(s);
      }
      return raw;
    };
  }, KEY);
  await signUpCustomer(page);
  await page.goto(`/chefs/${MAI}/book`);
  await hideOverlay(page);
  await fillRest(page, 5);
  await page.getByRole("checkbox", { name: "I have no allergies" }).check();
  await page.getByRole("checkbox", { name: "I have no dietary needs" }).check();
  await page
    .getByRole("checkbox", { name: /Save these answers to my allergy profile/ })
    .check();
  await sendBooking(page);
  await expect(page).toHaveURL(
    /\/bookings\/[0-9a-f-]{36}\?sent=1&profile=notsaved/,
  );
  const note = page.getByTestId("profile-not-saved");
  await expect(note).toBeVisible();
  await expect(note).toContainText("could not be saved");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Booking with",
  );
  await expectNoAxeViolations(page);
  // Nothing was saved.
  await page.goto("/allergies");
  await expect(page.getByTestId("saved-state")).toContainText(
    "Nothing is saved yet",
  );
});

test("a new booking after an unsaved edit starts again from the saved profile (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await page.goto("/allergies");
  await page.getByRole("checkbox", { name: "Mustard" }).check();
  await page.getByLabel("Other allergies or details").fill("Carries an EpiPen");
  await page.getByRole("checkbox", { name: "I have no dietary needs" }).check();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByTestId("profile-status")).toContainText("Saved");

  await page.goto(`/chefs/${MAI}/book`);
  await hideOverlay(page);
  await fillRest(page, 5);
  // Change the answers, do not ask to save them.
  await page.getByLabel("Other allergies or details").fill("Changed here");
  await sendBooking(page);
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}/);

  // Back to the form page in the same tab through the app: the sent state offers another visit.
  await page.goto(`/chefs/${MAI}/book`);
  await hideOverlay(page);
  await expect(page.getByLabel("Other allergies or details")).toHaveValue(
    "Carries an EpiPen",
  );
  await fillRest(page, 6);
  await page.getByLabel("Other allergies or details").fill("Second visit");
  await sendBooking(page);
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}/);
});

test("Book another visit button refills from the profile just saved, not the one loaded at page open (MOCK)", async ({
  page,
}) => {
  // BUG T67-T1 (LOW): the refill uses the snapshot loaded when the page opened, so after the
  // customer replaced the profile with this booking, the next visit shows the OLD answers.
  await signUpCustomer(page);
  await page.goto("/allergies");
  await page.getByRole("checkbox", { name: "Mustard" }).check();
  await page.getByRole("checkbox", { name: "I have no dietary needs" }).check();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByTestId("profile-status")).toContainText("Saved");

  await page.goto(`/chefs/${MAI}/book`);
  await hideOverlay(page);
  await fillRest(page, 5);
  await page.getByLabel("Other allergies or details").fill("Sesame too");
  await page
    .getByRole("checkbox", { name: /Replace my saved allergy profile/ })
    .check();
  // Hold the page on the sent state: the navigation request hangs the way a very slow network would.
  await page.route("**/bookings/**", () => {}); // never answered: the page stays on the sent state
  await sendBooking(page);
  const another = page.getByRole("button", {
    name: "Book another visit with this chef",
  });
  await expect(another).toBeVisible();
  await another.click();
  await expect(page.getByRole("checkbox", { name: "Mustard" })).toBeChecked();
  // The PUT ran (box was ticked), so the profile now holds the new text and the form shows it.
  await expect(page.getByLabel("Other allergies or details")).toHaveValue(
    "Sesame too",
  );
  await expect(page.getByTestId("save-to-profile")).toHaveCount(0);
});

test("Book another visit still works when the profile save fails, and refills from the old profile (MOCK)", async ({
  page,
}) => {
  // Click-timing regression check: the button awaits the PUT; a failed PUT must not block it.
  await page.addInitScript((key) => {
    const w = window as unknown as { __break?: boolean };
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === key && this === window.sessionStorage) {
        try {
          if ((JSON.parse(v).bookings ?? []).length > 0) w.__break = true;
        } catch {
          /* ignore */
        }
      }
      return set.call(this, k, v);
    };
    Storage.prototype.getItem = function (k: string) {
      const raw = get.call(this, k);
      if (k === key && this === window.sessionStorage && w.__break && raw) {
        w.__break = false;
        const s = JSON.parse(raw);
        s.profile.role = "chef";
        return JSON.stringify(s);
      }
      return raw;
    };
  }, KEY);
  await signUpCustomer(page);
  await page.goto("/allergies");
  await page.getByRole("checkbox", { name: "Mustard" }).check();
  await page.getByRole("checkbox", { name: "I have no dietary needs" }).check();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByTestId("profile-status")).toContainText("Saved");

  await page.goto(`/chefs/${MAI}/book`);
  await hideOverlay(page);
  await fillRest(page, 5);
  await page.getByLabel("Other allergies or details").fill("Sesame too");
  await page
    .getByRole("checkbox", { name: /Replace my saved allergy profile/ })
    .check();
  await page.route("**/bookings/**", () => {});
  await sendBooking(page);
  const another = page.getByRole("button", {
    name: "Book another visit with this chef",
  });
  await expect(another).toBeVisible();
  await another.click();
  // The form is back (the free-first-booking check may still be running in this synthetic setup).
  await expect(page.getByTestId("review-heading")).toHaveCount(0);
  // The save failed, so the profile is still the old one (Mustard, no note).
  await expect(page.getByRole("checkbox", { name: "Mustard" })).toBeChecked({
    timeout: 5000,
  });
  await expect(page.getByLabel("Other allergies or details")).toHaveValue("");
});

test("a note with a control character is refused next to the field and the profile is not saved (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await page.goto("/allergies");
  await hideOverlay(page);
  await page.getByLabel("Other allergies or details").fill("bad \u0001 text");
  await page.getByRole("checkbox", { name: "I have no dietary needs" }).check();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByTestId("error-summary")).toBeFocused();
  // Once in the summary and once next to the question.
  await expect(page.getByText(/control or invalid characters/)).toHaveCount(2);
  await expectNoAxeViolations(page);
  await page.reload();
  await expect(page.getByTestId("saved-state")).toContainText(
    "Nothing is saved yet",
  );
});

test("a blank form is refused on a fresh profile and keeps the answers the customer typed (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await page.goto("/allergies");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByTestId("error-summary")).toBeFocused();
  // Two problems are listed, one per question.
  await expect(page.getByTestId("error-summary").getByRole("link")).toHaveCount(
    2,
  );
});

test("the profile is forgotten on log out (MOCK)", async ({ page }) => {
  await signUpCustomer(page);
  await page.goto("/allergies");
  await page.getByRole("checkbox", { name: "I have no allergies" }).check();
  await page.getByRole("checkbox", { name: "I have no dietary needs" }).check();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByTestId("profile-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(
    page.getByRole("link", { name: "Log in" }).first(),
  ).toBeVisible();
  expect(
    await page.evaluate((k) => sessionStorage.getItem(k) ?? "", KEY),
  ).not.toContain("noAllergies");
  // A logged-out visitor cannot open the page.
  await page.goto("/allergies");
  await expect(page).toHaveURL(/\/login/);
  await signUpCustomer(page);
  await page.goto("/allergies");
  await expect(page.getByTestId("saved-state")).toContainText(
    "Nothing is saved yet",
  );
});

test("an admin is sent away from the profile page (MOCK)", async ({ page }) => {
  await loginAdmin(page);
  await page.goto("/allergies");
  await expect(page).not.toHaveURL(/\/allergies/);
});

test("the booking form at 375px with a saved profile has no sideways scroll (MOCK)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await signUpCustomer(page);
  await page.goto("/allergies");
  await page.getByRole("checkbox", { name: "Mustard" }).check();
  await page.getByRole("checkbox", { name: "I have no dietary needs" }).check();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByTestId("profile-status")).toContainText("Saved");
  await page.getByRole("button", { name: "Delete saved profile" }).click();
  await expect(
    page.getByRole("group", { name: "Confirm delete" }),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  await page.goto(`/chefs/${MAI}/book`);
  await expect(page.getByTestId("prefilled-note")).toBeVisible();
  await page.getByLabel("Other allergies or details").fill("Changed");
  await expect(page.getByTestId("save-to-profile")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
});
