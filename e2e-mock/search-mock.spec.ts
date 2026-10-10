import { expect, test, type Page } from "@playwright/test";
import { PNG, expectNoAxeViolations } from "./helpers";

// MOCK mode. The mock adapter plays the server (src/lib/mocks/mock-search.ts): eight real-looking
// chefs plus fourteen fillers, all made up. Map tiles come from OpenStreetMap; the tests answer
// them with a one-pixel picture so no run depends on the network.
test.beforeEach(async ({ page }) => {
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: PNG.buffer }),
  );
});

async function openSearch(page: Page) {
  await page.goto("/search");
  // Next's development badge sits at the bottom left and can cover a button the test must click.
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await expect(
    page.getByRole("heading", { level: 1, name: "Find a home cook" }),
  ).toBeVisible();
  // The city list arrives from the (mock) reference route.
  await expect(page.getByLabel("Or a city")).toBeEnabled();
}
const find = (page: Page) =>
  page.getByRole("button", { name: "Find chefs" }).click();
const results = (page: Page) => page.getByTestId("chef-result");

test("a customer finds a Vietnamese chef in Mississauga (demo step 1) (MOCK)", async ({
  page,
}) => {
  await openSearch(page);
  await page.getByLabel("Or a city").selectOption("Mississauga");
  await page.getByLabel("Cuisine").fill("Vietnamese");
  await find(page);

  await expect(page.getByTestId("results-status")).toHaveText(
    "Showing 2 chefs.",
  );
  // Focus moves to the results heading so a screen reader starts at the answer.
  await expect(
    page.getByRole("heading", { level: 2, name: "Results" }),
  ).toBeFocused();
  await expect(results(page)).toHaveCount(2);
  const first = results(page).first();
  await expect(first).toContainText("Mai Tran (MOCK)");
  await expect(first).toContainText("Cuisines: Vietnamese");
  await expect(first).toContainText("Languages: English, Vietnamese");
  await expect(first).toContainText("$28/hour");
  await expect(first).toContainText("4.8 out of 5 (14 reviews)");
  await expect(first).toContainText("km away");
  const link = first.getByRole("link", { name: "Mai Tran (MOCK)" });
  await expect(link).toHaveAttribute(
    "href",
    /^\/chefs\/00000000-0000-4000-8000-/,
  );

  // No search by nationality anywhere (CLAUDE.md 6.3): cuisine and languages only.
  await expect(page.getByText(/nationality|ethnic/i)).toHaveCount(0);
  await expectNoAxeViolations(page);

  // The result links to the chef page (a placeholder until T-041).
  await link.click();
  await expect(page).toHaveURL(/\/chefs\/00000000-/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("results are nearest first, and chefs out of reach but bookable at home say so (A-18) (MOCK)", async ({
  page,
}) => {
  await openSearch(page);
  await page.getByLabel("Postal code").fill("l5b 1a1");
  await find(page);
  await expect(page.getByTestId("results-status")).toContainText("Showing");

  const km = await results(page)
    .locator("text=/\\d+\\.\\d km away/")
    .allTextContents();
  const nums = km.map((t) => Number(/(\d+\.\d) km/.exec(t)![1]));
  expect(nums.length).toBeGreaterThan(3);
  expect(nums).toEqual([...nums].sort((a, b) => a - b));

  // Rosa works in Oakville and only cooks at her own kitchen: the label is clear.
  const rosa = results(page).filter({ hasText: "Rosa Mendes" });
  await expect(rosa.getByTestId("chef-home-only")).toHaveText(
    "Chef's home only",
  );
  await expect(
    results(page).filter({ hasText: "Mai Tran" }).getByTestId("chef-home-only"),
  ).toHaveCount(0);

  // Choosing "At the chef's home" keeps only chefs bookable at their own home.
  await page.getByRole("radio", { name: "At the chef's home" }).check();
  await find(page);
  await expect(results(page)).toHaveCount(3);
  await expectNoAxeViolations(page);
});

test("price, language, allergens and a day narrow the list; the allergen text is honest (MOCK)", async ({
  page,
}) => {
  await openSearch(page);
  await expect(page.getByText(/not an allergy guarantee/)).toBeVisible();
  await expect(
    page.getByText(/vegetarian or\s+halal are not supported yet/),
  ).toBeVisible();

  await page.getByLabel("Language the chef speaks (optional)").fill("tamil");
  await find(page);
  await expect(results(page)).toHaveCount(1);
  await expect(results(page).first()).toContainText("Priya Raman");

  await page.getByLabel("Language the chef speaks (optional)").fill("");
  await page.getByLabel("Highest hourly rate ($)").fill("25.00");
  await find(page);
  await expect(results(page).first()).toContainText("$25/hour");

  await page.getByLabel("Highest hourly rate ($)").fill("");
  await page.getByLabel("Cuisine").fill("Ghanaian");
  await page.getByRole("checkbox", { name: "Peanuts" }).check();
  await find(page);
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(results(page)).toHaveCount(0);
  await expect(page.getByTestId("results-status")).toHaveText(
    "No chefs match this search.",
  );
  await expectNoAxeViolations(page);

  // A day inside the window is accepted and sent.
  await page.getByRole("checkbox", { name: "Peanuts" }).uncheck();
  await page.getByLabel("Cuisine").fill("");
  const min = await page
    .getByLabel("Day you need a chef (optional)")
    .getAttribute("min");
  await page.getByLabel("Day you need a chef (optional)").fill(min!);
  await find(page);
  await expect(results(page).first()).toBeVisible();
});

test("errors appear next to the field and focus goes to the first one (MOCK)", async ({
  page,
}) => {
  await openSearch(page);
  await page.getByLabel("Postal code").fill("V6B 1A1");
  await page.getByLabel("Lowest hourly rate ($)").fill("abc");
  await page.getByLabel("Highest hourly rate ($)").fill("1500");
  await find(page);

  const postal = page.getByLabel("Postal code");
  await expect(postal).toBeFocused();
  await expect(postal).toHaveAttribute("aria-invalid", "true");
  await expect(postal).toHaveAccessibleDescription(/Not a GTA postal code/);
  await expect(
    page.getByLabel("Lowest hourly rate ($)"),
  ).toHaveAccessibleDescription(/Enter dollars/);
  await expect(page.getByLabel("Highest hourly rate ($)")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(
    page.getByRole("alert").filter({ hasText: "Check the highlighted" }),
  ).toBeVisible();
  await expect(results(page)).toHaveCount(0);
  await expectNoAxeViolations(page);

  // A postal code and a city together.
  await page.getByLabel("Postal code").fill("L5B");
  await page.getByLabel("Lowest hourly rate ($)").fill("");
  await page.getByLabel("Highest hourly rate ($)").fill("");
  await page.getByLabel("Or a city").selectOption("Toronto");
  await find(page);
  await expect(page.getByLabel("Or a city")).toBeFocused();
  await expect(page.getByLabel("Or a city")).toHaveAccessibleDescription(
    /not both/,
  );

  // Fixing it clears the errors.
  await page.getByLabel("Or a city").selectOption("");
  await find(page);
  await expect(page.getByLabel("Postal code")).not.toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(results(page).first()).toBeVisible();
});

test("a server failure is shown, focused, and the form keeps its values (MOCK)", async ({
  page,
}) => {
  await openSearch(page);
  await page.getByLabel("Cuisine").fill("explode");
  await find(page);
  const alert = page.getByRole("alert").filter({ hasText: "not working" });
  await expect(alert).toBeFocused();
  await expect(page.getByLabel("Cuisine")).toHaveValue("explode");
  await expectNoAxeViolations(page);
});

test("Load more continues the list and moves focus to the first new result (MOCK)", async ({
  page,
}) => {
  await openSearch(page);
  await find(page); // everyone: 22 chefs, 20 per page
  await expect(results(page)).toHaveCount(20);
  await expect(page.getByTestId("results-status")).toHaveText(
    "Showing 20 chefs. More are available.",
  );

  // Without a location the order is rating, then name: no distances are shown.
  await expect(results(page).first()).not.toContainText("km away");

  await page.getByRole("button", { name: "Load more" }).click();
  await expect(results(page)).toHaveCount(22);
  const firstNew = results(page).nth(20).getByRole("link");
  await expect(firstNew).toBeFocused();
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
  await expect(page.getByTestId("results-status")).toHaveText(
    "Showing 22 chefs.",
  );

  // No chef appears twice.
  const names = await results(page).getByRole("link").allTextContents();
  expect(new Set(names).size).toBe(22);
  await expectNoAxeViolations(page);
});

test("the map: collapsed on a phone, keyboard pins, synced with the list, attribution (MOCK)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await openSearch(page);
  await page.getByLabel("Or a city").selectOption("Mississauga");
  await find(page);
  await expect(results(page).first()).toBeVisible();

  // The list works with no map; the map starts collapsed on a narrow screen.
  const toggle = page.getByRole("button", { name: "Show map" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("chef-map")).toHaveCount(0);

  await toggle.click();
  const map = page.getByTestId("chef-map");
  await expect(map).toBeVisible();
  await expect(page.getByRole("button", { name: "Hide map" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(map.locator(".leaflet-tile-loaded").first()).toBeVisible();

  // OpenStreetMap attribution is on the map.
  await expect(
    map.getByRole("link", { name: "OpenStreetMap" }),
  ).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");

  // Pins are buttons with names and counts; the origin dot is not a control.
  const pin = map.getByRole("button", {
    name: /^Mississauga: \d+ chefs?\. Press Enter/,
  });
  await expect(pin).toHaveCount(1);
  await expect(pin).toHaveAttribute("aria-pressed", "false");

  // Keyboard: Tab onto the pin, Enter selects it. The list marks the same chefs.
  await pin.focus();
  await page.keyboard.press("Enter");
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("map-selection")).toContainText("Mississauga:");
  await expect(
    page
      .getByTestId("map-selection")
      .getByRole("link", { name: "Mai Tran (MOCK)" }),
  ).toBeVisible();
  await expect(page.locator('[data-selected="true"]').first()).toBeVisible();
  // Space toggles it off again.
  await page.keyboard.press("Space");
  await expect(pin).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('[data-selected="true"]')).toHaveCount(0);

  // From the list: "Show on map" selects the pin.
  await results(page)
    .first()
    .getByRole("button", { name: /^Show on map/ })
    .click();
  await expect(pin).toHaveAttribute("aria-pressed", "true");

  // No sideways scrolling at 375 px.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);

  await page.getByRole("button", { name: "Hide map" }).click();
  await expect(page.getByTestId("chef-map")).toHaveCount(0);
  await expect(results(page).first()).toBeVisible();
});

test("axe is clean in dark mode, with the map open (MOCK)", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await openSearch(page);
  await expectNoAxeViolations(page);
  await page.getByLabel("Postal code").fill("L5B");
  await find(page);
  await expect(results(page).first()).toBeVisible();
  // Wide screens open the map by themselves.
  await expect(page.getByTestId("chef-map")).toBeVisible();
  await expect(page.getByRole("button", { name: "Hide map" })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("keyboard only: fill the form and search with Enter (MOCK)", async ({
  page,
}) => {
  await openSearch(page);
  await page.getByLabel("Postal code").focus();
  await page.keyboard.type("L5B 1A1");
  await page.keyboard.press("Tab"); // city
  await page.keyboard.press("Tab"); // radio (at my home)
  await page.keyboard.press("Tab"); // cuisine (the radio group is one tab stop)
  await page.keyboard.type("Vietnamese");
  await page.keyboard.press("Enter");
  await expect(results(page).first()).toContainText("Mai Tran");
  await expect(
    page.getByRole("heading", { level: 2, name: "Results" }),
  ).toBeFocused();
});

test("the home page links to the search (MOCK)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Find a home cook" }).click();
  await expect(page).toHaveURL(/\/search$/);
});
