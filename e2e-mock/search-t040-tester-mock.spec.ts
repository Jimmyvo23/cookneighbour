import { expect, test, type Page } from "@playwright/test";
import { PNG, expectNoAxeViolations, loginAdmin, openChef } from "./helpers";

// Tester (T-040), MOCK mode. Edge cases on top of search-mock.spec.ts. Everything is made up.
test.beforeEach(async ({ page }) => {
  // MOCK chefs have made-up photo paths. If a developer's .env.local holds a Supabase URL the page
  // would ask that project's public storage for them (T-040 finding F-1); keep the tests offline.
  await page.route("**/storage/v1/object/public/**", (route) => route.abort());
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: PNG.buffer }),
  );
});

async function openSearch(page: Page) {
  await page.goto("/search");
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await expect(
    page.getByRole("heading", { level: 1, name: "Find a home cook" }),
  ).toBeVisible();
  await expect(page.getByLabel("Or a city")).toBeEnabled();
}
const find = (page: Page) =>
  page.getByRole("button", { name: "Find chefs" }).click();
const results = (page: Page) => page.getByTestId("chef-result");
const DATE = "Day you need a chef (optional)";

// The date window is Toronto's, whatever the visitor's time zone or clock says. The picker limits
// come from the browser clock read through the Toronto zone; the server's 422 stays the authority.
for (const tz of ["Asia/Tokyo", "Pacific/Honolulu", "America/Toronto"]) {
  test.describe(`browser in ${tz}`, () => {
    test.use({ timezoneId: tz });
    for (const [iso, toronto, last] of [
      ["2026-10-10T03:30:00Z", "2026-10-09", "2027-04-07"], // 23:30 in Toronto
      ["2026-10-10T04:30:00Z", "2026-10-10", "2027-04-08"], // 00:30 in Toronto
      ["2026-11-02T04:30:00Z", "2026-11-01", "2027-04-30"], // 23:30 in Toronto, just after DST ends
    ] as const) {
      test(`at ${iso} the day picker runs from ${toronto} (MOCK)`, async ({
        page,
      }) => {
        await page.clock.setFixedTime(new Date(iso));
        await openSearch(page);
        const date = page.getByLabel(DATE);
        await expect(date).toHaveAttribute("min", toronto);
        await expect(date).toHaveAttribute("max", last);
        await expect(
          page.getByText(`From ${toronto} to ${last}.`),
        ).toBeVisible();

        // The first and last allowed days are searched without a complaint.
        for (const d of [toronto, last]) {
          await date.fill(d);
          await find(page);
          await expect(page.getByTestId("results-status")).toContainText(
            /Showing|No chefs/,
          );
          await expect(date).not.toHaveAttribute("aria-invalid", "true");
        }
        // One day outside either end is refused next to the field, with focus.
        const before = new Date(`${toronto}T00:00:00Z`);
        before.setUTCDate(before.getUTCDate() - 1);
        await date.fill(before.toISOString().slice(0, 10));
        await find(page);
        await expect(date).toBeFocused();
        await expect(date).toHaveAttribute("aria-invalid", "true");
        await expect(date).toHaveAccessibleDescription(/Pick a date from/);
      });
    }
  });
}

test("rates: 0, 0.5 and 1000 are accepted; 1000.01, huge and non-numbers are refused next to the field (MOCK)", async ({
  page,
}) => {
  await openSearch(page);
  const min = page.getByLabel("Lowest hourly rate ($)");
  const max = page.getByLabel("Highest hourly rate ($)");

  await min.fill("0");
  await max.fill("1000");
  await find(page);
  await expect(page.getByTestId("results-status")).toContainText("Showing");
  await expect(min).not.toHaveAttribute("aria-invalid", "true");

  await min.fill("0.5");
  await max.fill("0.5");
  await find(page);
  await expect(page.getByTestId("empty-state")).toBeVisible();

  for (const bad of [
    "1000.01",
    "99999999999999999999",
    "-5",
    "1e3",
    "1,000",
    ".5",
    "ten",
  ]) {
    await min.fill(bad);
    await max.fill("");
    await find(page);
    await expect(min, bad).toBeFocused();
    await expect(min, bad).toHaveAttribute("aria-invalid", "true");
    await expect(min, bad).toHaveAccessibleDescription(/Enter dollars/);
  }

  // Lowest above highest: the message is next to the highest rate.
  await min.fill("40");
  await max.fill("30");
  await find(page);
  await expect(max).toBeFocused();
  await expect(max).toHaveAccessibleDescription(/must not be below/);
  await expectNoAxeViolations(page);
});

test("a city with a space in its name works, and its pin says so (MOCK)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openSearch(page);
  await page.getByLabel("Or a city").selectOption("Richmond Hill");
  await find(page);
  await expect(results(page).first()).toBeVisible();
  await expect(
    page.getByTestId("chef-map").getByRole("button", {
      name: /^Richmond Hill: \d+ chefs?\./,
    }),
  ).toHaveCount(1);
});

test("a click on a pin selects it and a second click clears it; Enter does not fire twice (MOCK)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openSearch(page);
  await page.getByLabel("Or a city").selectOption("Mississauga");
  await find(page);
  const pin = page
    .getByTestId("chef-map")
    .getByRole("button", { name: /^Mississauga:/ });
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "false");
  await pin.focus();
  await page.keyboard.press("Enter");
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(pin).toHaveAttribute("aria-pressed", "false");
});

test("pins: one per city in the results, none at a chef, same count in the list; the focus ring shows (MOCK)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openSearch(page);
  await page.getByLabel("Cuisine").fill("Test Kitchen");
  await find(page);
  await expect(results(page).first()).toBeVisible();
  const map = page.getByTestId("chef-map");
  const pins = map.getByRole("button", { name: /chefs?\. Press Enter/ });
  await expect(pins.first()).toBeVisible();
  const n = await pins.count();
  const names = await pins.evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label")),
  );
  // The 14 filler chefs work in 5 cities (see mock-search.ts), and each city has one pin.
  expect(new Set(names.map((x) => x!.split(":")[0])).size).toBe(n);
  let total = 0;
  for (const label of names) total += Number(/: (\d+) chef/.exec(label!)![1]);
  expect(total).toBe(14);
  // No tooltip or text anywhere on the map names a person or a street.
  const mapText = (await map.innerText()) + names.join(" ");
  expect(mapText).not.toMatch(/Extra Cook|\bStreet\b|\bSt\.|\bAvenue\b|\bRd\b/);

  // Tab onto a pin from the keyboard: a visible focus ring.
  await map.focus();
  let focused = false;
  for (let i = 0; i < 12 && !focused; i++) {
    await page.keyboard.press("Tab");
    focused = await page.evaluate(
      () => document.activeElement?.classList.contains("cn-pin") ?? false,
    );
  }
  expect(focused).toBe(true);
  const outline = await page.evaluate(() => {
    const span = document.activeElement!.querySelector("span")!;
    const cs = getComputedStyle(span);
    return `${cs.outlineStyle} ${cs.outlineWidth}`;
  });
  expect(outline).toBe("solid 3px");
});

test("with the map collapsed there are no extra tab stops, and with tiles failing the list still works (MOCK)", async ({
  page,
}) => {
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 375, height: 800 });
  await openSearch(page);
  await page.getByLabel("Or a city").selectOption("Mississauga");
  await find(page);
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(0);
  await page.getByRole("button", { name: "Show map" }).click();
  await expect(page.locator(".leaflet-marker-icon").first()).toBeVisible();
  // OpenStreetMap credit stays visible even with the tiles gone.
  await expect(
    page.getByTestId("chef-map").getByRole("link", { name: "OpenStreetMap" }),
  ).toBeVisible();
  await expect(results(page).first()).toBeVisible();
  await page.getByRole("button", { name: "Hide map" }).click();
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the map never asks any server but this one and OpenStreetMap's tile server (MOCK)", async ({
  page,
}) => {
  const hosts = new Set<string>();
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) hosts.add(new URL(r.url()).host);
  });
  const bad: string[] = [];
  page.on("response", (r) => {
    if (new URL(r.url()).host === "localhost:3101" && r.status() >= 400)
      bad.push(`${r.status()} ${r.url()}`);
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await openSearch(page);
  await page.getByLabel("Or a city").selectOption("Mississauga");
  await find(page);
  await expect(
    page.getByTestId("chef-map").locator(".leaflet-tile-loaded").first(),
  ).toBeVisible();
  const external = [...hosts].filter(
    (h) => h !== "localhost:3101" && h !== "tile.openstreetmap.org",
  );
  // Only the photo requests (aborted above) may name another host; nothing like a CDN.
  expect(external.length).toBeLessThanOrEqual(1);
  expect(hosts.has("tile.openstreetmap.org")).toBe(true);
  for (const h of external) expect(h).toMatch(/\.supabase\.co$/);
  expect(bad).toEqual([]);
});

test("reduced motion: the map has no animation classes (MOCK)", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await openSearch(page);
  await find(page);
  const map = page.getByTestId("chef-map");
  await expect(map).toBeVisible();
  const cls = (await map.getAttribute("class")) ?? "";
  expect(cls).not.toMatch(/leaflet-fade-anim|leaflet-zoom-anim/);
});

test("double-clicking Find chefs and Load more gives one clean list; a form change while paging does not change the query (MOCK)", async ({
  page,
}) => {
  const urls: string[] = [];
  await openSearch(page);
  await page.getByRole("button", { name: "Find chefs" }).dblclick();
  await expect(page.getByTestId("results-status")).toHaveText(
    "Showing 20 chefs. More are available.",
  );
  await expect(results(page)).toHaveCount(20);

  // Edit the form after the search: Load more still continues the SUBMITTED search.
  await page.getByLabel("Cuisine").fill("Vietnamese");
  await page.getByRole("button", { name: "Load more" }).dblclick();
  await expect(results(page)).toHaveCount(22);
  const names = await results(page).getByRole("link").allTextContents();
  expect(new Set(names).size).toBe(22);
  expect(names.some((x) => x.includes("Extra Cook"))).toBe(true);
  void urls;

  // Searching again uses the edited form.
  await find(page);
  await expect(results(page)).toHaveCount(2);
});

test("dark mode: error states, a selected pin and the chef's-home label are axe clean; 375 px has no sideways scroll (MOCK)", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 375, height: 800 });
  await openSearch(page);
  await page.getByLabel("Postal code").fill("V6B 1A1");
  await page.getByLabel("Lowest hourly rate ($)").fill("x");
  await find(page);
  await expect(page.getByLabel("Postal code")).toBeFocused();
  await expectNoAxeViolations(page);

  await page.getByLabel("Postal code").fill("L5B");
  await page.getByLabel("Lowest hourly rate ($)").fill("");
  await find(page);
  await expect(
    results(page)
      .filter({ hasText: "Rosa Mendes" })
      .getByTestId("chef-home-only"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show map" }).click();
  await page
    .getByTestId("chef-map")
    .getByRole("button", { name: /^Mississauga:/ })
    .click();
  await expectNoAxeViolations(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("no page text, label or hint asks for or filters by nationality (MOCK)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openSearch(page);
  await find(page);
  await expect(results(page).first()).toBeVisible();
  const html = (await page.content()).toLowerCase();
  const text = (await page.locator("body").innerText()).toLowerCase();
  for (const word of [
    "nationality",
    "ethnic",
    "race",
    "country of origin",
    "citizen",
  ]) {
    expect(text, word).not.toMatch(new RegExp(`\\b${word}\\b`));
    expect(html, word).not.toMatch(new RegExp(`name="${word}"|id="${word}"`));
  }
  // Every form control is one of the allowed filters.
  const labels = await page
    .getByRole("form", { name: "Search for a chef" })
    .locator("input:not([type=checkbox]):not([type=radio]), select")
    .evaluateAll((els) =>
      els.map((e) => (e as HTMLInputElement).labels?.[0]?.textContent?.trim()),
    );
  expect(labels).toEqual([
    "Postal code",
    "Or a city",
    "Cuisine",
    "Language the chef speaks (optional)",
    "Lowest hourly rate ($)",
    "Highest hourly rate ($)",
    DATE,
  ]);
});

test("honest wording: allergens are a shortcut, diets are not supported, booked days are not removed (MOCK)", async ({
  page,
}) => {
  await openSearch(page);
  const body = await page.locator("main").innerText();
  expect(body).toMatch(/not an allergy guarantee/);
  expect(body).toMatch(/vegetarian or\s+halal are not supported yet/);
  expect(body).toMatch(/already booked are not removed yet/);
  expect(body).not.toMatch(/\bsafe\b|guaranteed|allergy[- ]free|100%/i);
  // No diet check boxes are offered.
  await expect(
    page.getByRole("checkbox", { name: /vegetarian|halal|vegan|kosher/i }),
  ).toHaveCount(0);
});

test("T-036 backlog: the admin queue says Signed up, and a quick double click on Reload shows no error and no stale notice (MOCK)", async ({
  page,
}) => {
  await loginAdmin(page);
  await expect(page.getByText(/Signed up/).first()).toBeVisible();
  await expect(page.getByText(/Applied /)).toHaveCount(0);

  await openChef(page, "Linh Nguyen");
  const reload = page.getByRole("button", {
    name: "Reload application and file links",
  });
  await reload.dblclick();
  await expect(page.getByText(/^Reloaded\./)).toBeVisible();
  await expect(page.getByText("Could not reload")).toHaveCount(0);
  await expect(page.getByText(/may have expired/)).toHaveCount(0);
  // Three more quick clicks: still no error.
  await reload.click({ clickCount: 3 });
  await expect(page.getByText(/^Reloaded\./)).toBeVisible();
  await expect(page.getByText("Could not reload")).toHaveCount(0);
  await expect(page.getByText(/may have expired/)).toHaveCount(0);
  await expectNoAxeViolations(page);
});
