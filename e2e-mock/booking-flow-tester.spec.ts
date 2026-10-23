import { expect, test } from "@playwright/test";
import {
  blockStorage,
  dayPlus,
  hideDevOverlay,
  signUpCustomer,
} from "./helpers";

// T-043 tester additions, MOCK mode. Dates offered, 1 to 3 days, booked dates hidden, same date twice.
const MAI = "00000000-0000-4000-8000-000000001001";

test.beforeEach(async ({ page }) => {
  await hideDevOverlay(page);
  await blockStorage(page);
});

async function open(page: import("@playwright/test").Page) {
  await page.goto(`/chefs/${MAI}/book`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test("the form offers 1 to 3 days only and never today or a past date (MOCK, D-27)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await open(page);
  const counts = await page
    .getByLabel("How many days?")
    .locator("option")
    .evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
  expect(counts).toEqual(["1", "2", "3"]);
  const dates = await page
    .getByLabel("Date for day 1")
    .locator("option")
    .evaluateAll((o) =>
      o.map((x) => (x as HTMLOptionElement).value).filter(Boolean),
    );
  expect(dates.length).toBeGreaterThan(0);
  const today = dayPlus(0);
  for (const d of dates) expect(d > today).toBe(true);
  await page.getByLabel("How many days?").selectOption("3");
  await expect(page.getByLabel("Date for day 3")).toBeVisible();
  await expect(page.getByLabel("Date for day 4")).toHaveCount(0);
});

test("a date is not offered twice, and a booked date after booking (MOCK)", async ({
  page,
}) => {
  await signUpCustomer(page);
  await open(page);
  await page.getByLabel("How many days?").selectOption("2");
  await page.getByLabel("Date for day 1").selectOption(dayPlus(5));
  // A date already chosen for day 1 is not offered again for day 2.
  const day2 = await page
    .getByLabel("Date for day 2")
    .locator("option")
    .evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
  expect(day2).not.toContain(dayPlus(5));
  await page.getByLabel("Date for day 2").selectOption(dayPlus(6));
  await page.getByRole("checkbox", { name: "Pho bo on day 1" }).check();
  await page.getByRole("checkbox", { name: "Pho bo on day 2" }).check();
  await page.getByRole("radio", { name: "At your home" }).check();
  await page.getByRole("radio", { name: "I buy the ingredients" }).check();
  await page.getByRole("checkbox", { name: "I have no allergies" }).check();
  await page.getByRole("checkbox", { name: "I have no dietary needs" }).check();

  // Book one day, then the date is gone from a fresh form.
  await page.getByLabel("How many days?").selectOption("1");
  await page.getByRole("button", { name: "Review my request" }).click();
  await expect(page.getByTestId("review-heading")).toBeVisible();
  await page.getByRole("button", { name: "Send booking request" }).click();
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}/);
  await open(page);
  const values = await page
    .getByLabel("Date for day 1")
    .locator("option")
    .evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
  expect(values).not.toContain(dayPlus(5));
});
