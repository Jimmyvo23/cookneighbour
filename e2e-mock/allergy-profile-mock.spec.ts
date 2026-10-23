import { expect, test, type Page } from "@playwright/test";
import {
  blockStorage,
  dayPlus,
  expectNoAxeViolations,
  hideDevOverlay,
  signUpChef,
  signUpCustomer,
} from "./helpers";

// T-067, MOCK mode: the saved allergy profile page and the prefilled booking form, against the
// mock adapter (src/lib/mocks/mock-adapter.ts). Everything lives in this browser tab only.
const MAI = "00000000-0000-4000-8000-000000001001";

test.beforeEach(async ({ page }) => {
  await hideDevOverlay(page);
  await blockStorage(page);
});

const noOverflow = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

async function saveProfile(page: Page) {
  await page.goto("/allergies");
  await expect(page.getByTestId("saved-state")).toContainText(
    "Nothing is saved yet",
  );
  await page.getByRole("checkbox", { name: "Mustard" }).check();
  await page.getByLabel("Other allergies or details").fill("Carries an EpiPen");
  await page.getByRole("checkbox", { name: "I have no dietary needs" }).check();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByTestId("profile-status")).toContainText("Saved");
  await expect(page.getByTestId("profile-status")).toBeFocused();
}

/** Everything on the booking form except the allergy and dietary answers. */
async function fillRest(page: Page) {
  await page.getByLabel("Date for day 1").selectOption(dayPlus(5));
  await page.getByRole("checkbox", { name: "Pho bo on day 1" }).check();
  await page.getByRole("radio", { name: "At the chef's home" }).check();
  await page.getByRole("radio", { name: "I buy the ingredients" }).check();
}

test("save, reload, edit and delete the profile (MOCK)", async ({ page }) => {
  await signUpCustomer(page);
  await saveProfile(page);
  await expectNoAxeViolations(page);

  await page.reload();
  await expect(page.getByTestId("saved-state")).toContainText("Saved on");
  await expect(page.getByRole("checkbox", { name: "Mustard" })).toBeChecked();
  await expect(page.getByLabel("Other allergies or details")).toHaveValue(
    "Carries an EpiPen",
  );

  // A blank answer is refused in the browser, and focus goes to the error summary.
  await page.getByRole("checkbox", { name: "Mustard" }).uncheck();
  await page.getByLabel("Other allergies or details").fill("");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByTestId("error-summary")).toBeFocused();
  await expectNoAxeViolations(page);

  // Delete needs a second press.
  await page.getByRole("checkbox", { name: "I have no allergies" }).check();
  await page.getByRole("button", { name: "Delete saved profile" }).click();
  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(
    page.getByRole("button", { name: "Delete saved profile" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Delete saved profile" }).click();
  await page.getByRole("button", { name: "Yes, delete it" }).click();
  await expect(page.getByTestId("profile-status")).toContainText("deleted");
  await expect(page.getByTestId("saved-state")).toContainText(
    "Nothing is saved yet",
  );
  await expect(
    page.getByRole("checkbox", { name: "Mustard" }),
  ).not.toBeChecked();
});

test("the page fits a phone and says nothing about who else can read it (MOCK)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await signUpCustomer(page);
  await page.goto("/allergies");
  await expect(page.getByTestId("saved-state")).toBeVisible();
  expect(await noOverflow(page)).toBeLessThanOrEqual(0);
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/admin|private|secret|confidential/i);
});

test("T-076: the replace box un-ticks itself when the answers match the profile again (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await saveProfile(page);
  await page.goto(`/chefs/${MAI}/book`);
  await expect(page.getByTestId("prefilled-note")).toBeVisible();
  const notes = page.getByLabel("Other allergies or details");
  await notes.fill("Mustard, severe");
  const box = page.getByRole("checkbox", {
    name: /Replace my saved allergy profile/,
  });
  await box.check();
  // Back to the saved answers: the box hides, and must not stay ticked behind the scenes.
  await notes.fill("Carries an EpiPen");
  await expect(page.getByTestId("save-to-profile")).toHaveCount(0);
  await notes.fill("Mustard, severe");
  await expect(box).not.toBeChecked();
});

test("a saved profile prefills the booking, edits stay per booking, and can replace the profile (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await saveProfile(page);

  await page.goto(`/chefs/${MAI}/book`);
  await expect(page.getByTestId("prefilled-note")).toContainText(
    "Filled in from your saved allergy profile",
  );
  await expect(page.getByRole("checkbox", { name: "Mustard" })).toBeChecked();
  await expect(page.getByLabel("Other allergies or details")).toHaveValue(
    "Carries an EpiPen",
  );
  await expect(page.getByTestId("save-to-profile")).toHaveCount(0);

  // Editing for this booking offers the choice, unticked.
  await page.getByLabel("Other allergies or details").fill("Mustard, severe");
  const box = page.getByRole("checkbox", {
    name: /Replace my saved allergy profile/,
  });
  await expect(box).not.toBeChecked();
  await expectNoAxeViolations(page);

  await fillRest(page);
  await page.getByRole("button", { name: "Review my request" }).click();
  await expect(page.getByTestId("review-heading")).toBeVisible();
  await page.getByRole("button", { name: "Send booking request" }).click();
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("profile-not-saved")).toHaveCount(0);

  // Not ticked: the profile is unchanged.
  await page.goto("/allergies");
  await expect(page.getByLabel("Other allergies or details")).toHaveValue(
    "Carries an EpiPen",
  );

  // Second booking, ticked: the profile is replaced.
  await page.goto(`/chefs/${MAI}/book`);
  await expect(page.getByTestId("prefilled-note")).toBeVisible();
  await page.getByLabel("Other allergies or details").fill("Mustard, severe");
  await page
    .getByRole("checkbox", { name: /Replace my saved allergy profile/ })
    .check();
  await page.getByLabel("Date for day 1").selectOption(dayPlus(6));
  await page.getByRole("checkbox", { name: "Pho bo on day 1" }).check();
  await page.getByRole("radio", { name: "At the chef's home" }).check();
  await page.getByRole("radio", { name: "I buy the ingredients" }).check();
  await page.getByRole("button", { name: "Review my request" }).click();
  await page.getByRole("button", { name: "Send booking request" }).click();
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}/);
  await page.goto("/allergies");
  await expect(page.getByLabel("Other allergies or details")).toHaveValue(
    "Mustard, severe",
  );
});

test("first booking with no profile can save the answers (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await page.goto(`/chefs/${MAI}/book`);
  await expect(page.getByTestId("prefilled-note")).toHaveCount(0);
  await fillRest(page);
  await page.getByRole("checkbox", { name: "I have no allergies" }).check();
  await page.getByRole("checkbox", { name: "I have no dietary needs" }).check();
  await page
    .getByRole("checkbox", { name: /Save these answers to my allergy profile/ })
    .check();
  await page.getByRole("button", { name: "Review my request" }).click();
  await page.getByRole("button", { name: "Send booking request" }).click();
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}/);
  await page.goto("/allergies");
  await expect(page.getByTestId("saved-state")).toContainText("Saved on");
  await expect(
    page.getByRole("checkbox", { name: "I have no allergies" }),
  ).toBeChecked();
});

test("a chef is sent away from the profile page (MOCK)", async ({ page }) => {
  await signUpChef(page, "Chef Chen");
  await page.goto("/allergies");
  await expect(page).toHaveURL(/\/$/);
});
