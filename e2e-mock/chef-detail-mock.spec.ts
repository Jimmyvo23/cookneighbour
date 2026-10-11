import { expect, test, type Page } from "@playwright/test";
import { PNG, blockStorage, expectNoAxeViolations } from "./helpers";

// T-041, MOCK mode: the public chef page against the mock adapter (src/lib/mocks/mock-search.ts).
// Every chef is made up. Ids: Mai Tran (approved, both locations) ...1001; a hidden chef (only an
// unapproved chef's home; D-25 makes her a 404 like any unknown chef) ...1050.
const MAI = "00000000-0000-4000-8000-000000001001";
const NADIA = "00000000-0000-4000-8000-000000001050";

let storageRequests: string[] = [];
test.beforeEach(async ({ page }) => {
  storageRequests = [];
  // MOCK photo paths are made up: a developer's .env.local must never make the page ask hosted storage.
  storageRequests = await blockStorage(page);
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: PNG.buffer }),
  );
});

async function open(page: Page, id: string) {
  await page.goto(`/chefs/${id}`);
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
}
const noOverflow = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

test("the chef page shows the profile, dishes with allergens, dates and a Book stub (MOCK)", async ({
  page,
}) => {
  await open(page, MAI);
  await expect(
    page.getByRole("heading", { level: 1, name: "Mai Tran (MOCK)" }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Mai Tran (MOCK) — CookNeighbour");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByText("$28/hour")).toBeVisible();
  await expect(page.getByText("4.8 out of 5 (14 reviews)")).toBeVisible();
  await expect(page.getByText("Cuisines: Vietnamese")).toBeVisible();
  await expect(page.getByText("Languages: English, Vietnamese")).toBeVisible();
  await expect(page.getByText("Works around Mississauga")).toBeVisible();

  // Labelled regions with an h2 each.
  for (const name of [
    "About",
    "Where the chef can cook",
    "Dishes",
    "Available days",
    "Book this chef",
  ]) {
    await expect(page.getByRole("region", { name })).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name, exact: true }),
    ).toBeVisible();
  }

  // Location options as the API returned them, with the kitchen check labelled MOCK.
  const where = page.getByRole("region", { name: "Where the chef can cook" });
  await expect(where.getByRole("listitem")).toHaveText([
    "At your home",
    "At the chef's home",
  ]);
  await expect(where).toContainText("reviewed by an admin");
  await expect(where.getByTestId("mock-badge")).toContainText("MOCK");

  // Dishes: words for allergens, every field, and the photo fallback (no storage request).
  const dishes = page.getByTestId("dish");
  await expect(dishes).toHaveCount(4);
  const bun = dishes.filter({ hasText: "Bun cha" });
  await expect(bun).toContainText("Cuisine: Vietnamese");
  await expect(bun).toContainText("Cooking time: 2 h");
  await expect(bun).toContainText("Serves: 4");
  await expect(bun).toContainText("Estimated ingredient cost: $30.00");
  await expect(bun).toContainText("Eat by: Eat within 2 days of cooking");
  await expect(bun.getByTestId("dish-allergens")).toContainText(
    "Contains: fish, soy, sesame",
  );
  await expect(
    dishes.filter({ hasText: "Rau muong" }).getByTestId("dish-allergens"),
  ).toHaveText(/No allergens listed by the chef/);
  await expect(page.getByTestId("dish-photo-fallback").first()).toBeVisible();
  await expect(page.getByTestId("chef-photo-fallback")).toBeVisible();

  // Dates: the first month is open and the days are real <time> elements.
  const dates = page.getByRole("region", { name: "Available days" });
  await expect(dates).toContainText("has not been booked on");
  await expect(dates).not.toContainText("not removed yet");
  await expect(dates.getByTestId("bookable-date").first()).toBeVisible();
  expect(await dates.locator("time[datetime]").count()).toBeGreaterThan(20);

  // The Book entry point is a stub: no booking is made.
  const book = page.getByTestId("book-stub");
  await expect(book).toHaveText("Booking opens soon");
  await expect(book).toHaveAttribute("aria-disabled", "true");
  await expect(book).toHaveAccessibleDescription(/does nothing yet/);
  await book.click({ force: true });
  await expect(page).toHaveURL(new RegExp(`/chefs/${MAI}$`));

  // Nothing private, and no request to hosted storage in MOCK mode.
  const text = (await page.locator("main").innerText()).toLowerCase();
  for (const word of ["phone", "email", "street", "postal code", "police"])
    expect(text).not.toContain(word);
  expect(storageRequests).toEqual([]);
});

test("the chef page passes axe in light and dark and fits 375 px wide (MOCK)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, MAI);
    await expect(page.getByTestId("dish").first()).toBeVisible();
    await expectNoAxeViolations(page);
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await open(page, "not-a-uuid");
  await expect(page.getByTestId("not-found")).toBeVisible();
  await expectNoAxeViolations(page);
  expect(await noOverflow(page)).toBeLessThanOrEqual(0);
});

test("every unknown chef shows the same 'Chef not found' (MOCK)", async ({
  page,
}) => {
  for (const id of [
    "not-a-uuid",
    "00000000-0000-4000-8000-000000000001", // unknown, as pending, rejected and hidden chefs are
    NADIA, // approved, but her only place to cook is an unapproved kitchen (D-25)
  ]) {
    await open(page, id);
    await expect(
      page.getByRole("heading", { level: 1, name: "Chef not found" }),
    ).toBeVisible();
    await expect(page).toHaveTitle("Chef not found — CookNeighbour");
    await expect(page.getByTestId("not-found")).toContainText(
      "We could not find this chef.",
    );
    await expect(page.getByTestId("dish")).toHaveCount(0);
  }
  await page.getByRole("link", { name: "Search for a home cook" }).click();
  await expect(page).toHaveURL(/\/search$/);
});

test("keyboard: the month details open with Enter and the Book stub does nothing (MOCK)", async ({
  page,
}) => {
  await open(page, MAI);
  const summaries = page.locator("summary");
  const second = summaries.nth(1);
  const details = page.locator("details").nth(1);
  await expect(details).not.toHaveAttribute("open", "");
  await second.focus();
  await expect(second).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("open", "");

  const book = page.getByTestId("book-stub");
  await book.focus();
  await expect(book).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await expect(page).toHaveURL(new RegExp(`/chefs/${MAI}$`));
  await expect(book).toBeFocused();
});

test("Back to the search keeps the filters and the results (MOCK)", async ({
  page,
}) => {
  await page.goto("/search");
  await expect(page.getByLabel("Or a city")).toBeEnabled();
  await page.getByLabel("Or a city").selectOption("Mississauga");
  await page.getByLabel("Cuisine").fill("Vietnamese");
  await page.getByRole("button", { name: "Find chefs" }).click();
  await expect(page.getByTestId("results-status")).toHaveText(
    "Showing 2 chefs.",
  );
  await expect(
    page.getByRole("list", { name: "Chefs, nearest first" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Mai Tran (MOCK)" }).click();
  await expect(page).toHaveURL(new RegExp(`/chefs/${MAI}$`));
  await expect(page.getByTestId("dish").first()).toBeVisible();

  // The browser's back button.
  await page.goBack();
  await expect(page.getByLabel("Cuisine")).toHaveValue("Vietnamese");
  await expect(page.getByLabel("Or a city")).toHaveValue("Mississauga");
  await expect(page.getByTestId("results-status")).toHaveText(
    "Showing 2 chefs.",
  );

  // The link on the chef page.
  await page.getByRole("link", { name: "Linh Nguyen (MOCK)" }).click();
  await page.getByRole("link", { name: "Back to the search" }).click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.getByLabel("Cuisine")).toHaveValue("Vietnamese");
  await expect(page.getByTestId("chef-result")).toHaveCount(2);
});

test("without a location the list says it is ordered by rating, not distance (A-25) (MOCK)", async ({
  page,
}) => {
  await page.goto("/search");
  await expect(page.getByLabel("Or a city")).toBeEnabled();
  await page.getByLabel("Cuisine").fill("Vietnamese");
  await page.getByRole("button", { name: "Find chefs" }).click();
  await expect(page.getByTestId("results-status")).toHaveText(
    "Showing 2 chefs.",
  );
  await expect(
    page.getByRole("list", { name: "Chefs, best rated first" }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Chefs, nearest first" }),
  ).toHaveCount(0);

  // The chef's-home note on the search form is labelled as a MOCK check.
  await page.getByRole("radio", { name: "At the chef's home" }).check();
  await expect(
    page.getByText("The kitchen review is a MOCK check"),
  ).toBeVisible();
});
