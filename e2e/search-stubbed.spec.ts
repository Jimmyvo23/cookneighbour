import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

// Tester (T-040). The search page against the real build of the app, but every /api call is
// answered by the test (page.route), so no database is needed and crafted answers are possible:
// field errors from the server, failures, repeats, odd text, extra keys. No real server is used.
// All names below are made up.
const PREFIXES = {
  items: [
    { prefix: "L5B", city: "Mississauga", lat: 43.592, lng: -79.642 },
    { prefix: "L5C", city: "Mississauga", lat: 43.572, lng: -79.654 },
    { prefix: "M5V", city: "Toronto", lat: 43.64, lng: -79.399 },
    { prefix: "L4B", city: "Richmond Hill", lat: 43.85, lng: -79.39 },
  ],
};

interface Item {
  id: string;
  displayName: string;
  photoPath: string;
  cuisines: string[];
  languages: string[];
  hourlyRateCents: number | null;
  currency: string;
  ratingAvg: number;
  reviewCount: number;
  serviceCity: string | null;
  serviceRadiusKm: number;
  distanceKm: number | null;
  locationOptions: string[];
  chefHomeOnly: boolean;
}
const uid = (n: number) =>
  `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const item = (n: number, o: Partial<Item> = {}): Item => ({
  id: uid(n),
  displayName: `Stub Cook ${n}`,
  photoPath: `${uid(n)}/photo.png`,
  cuisines: ["Vietnamese"],
  languages: ["English"],
  hourlyRateCents: 2500,
  currency: "CAD",
  ratingAvg: 4.5,
  reviewCount: 3,
  serviceCity: "Mississauga",
  serviceRadiusKm: 20,
  distanceKm: n / 10,
  locationOptions: ["customer_home"],
  chefHomeOnly: false,
  ...o,
});
const ok = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
const err = (
  route: Route,
  status: number,
  code: string,
  fields?: Record<string, string>,
) => ok(route, { error: { code, message: "Stub error.", fields } }, status);

type ChefsHandler = (route: Route, url: URL) => Promise<void> | void;

async function setup(page: Page, chefs: ChefsHandler) {
  await page.route("**/storage/v1/**", (r) => r.abort());
  await page.route("https://tile.openstreetmap.org/**", (r) =>
    r.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        "base64",
      ),
    }),
  );
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/reference/postal-prefixes")
      return ok(route, PREFIXES);
    if (url.pathname === "/api/chefs") return chefs(route, url);
    return err(route, 401, "UNAUTHENTICATED"); // /api/me and anything else: signed out
  });
  await page.goto("/search");
  // Next's development badge can sit over a button the test must click.
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
async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
}

test("nothing private is drawn even if an answer carries extra keys; odd text stays text; long names fit at 375 px", async ({
  page,
}) => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  const leaky = {
    ...item(1, {
      displayName: "<img src=x onerror=alert(1)>Evil",
      cuisines: ["<script>alert(2)</script>"],
    }),
    address: "12 Secret Lane",
    phone: "416-555-0199",
    email: "private@example.com",
    kitchenAddress: "99 Kitchen Court",
    servicePostalPrefix: "L5B",
    postalCode: "L5B 1A1",
  };
  const longName = item(2, {
    displayName: "N".repeat(120),
    cuisines: ["C".repeat(100)],
    photoPath: "../../etc/passwd",
  });
  await setup(page, (route) =>
    ok(route, { items: [leaky, longName], nextCursor: null }),
  );
  await page.setViewportSize({ width: 375, height: 800 });
  await find(page);
  await expect(results(page)).toHaveCount(2);
  const body = await page.locator("body").innerText();
  const html = await page.content();
  for (const secret of [
    "12 Secret Lane",
    "416-555-0199",
    "private@example.com",
    "99 Kitchen Court",
  ]) {
    expect(body).not.toContain(secret);
    expect(html).not.toContain(secret);
  }
  // Markup is text.
  await expect(results(page).first()).toContainText("<img src=x");
  expect(dialogs).toEqual([]);
  expect(await page.locator("main img[src='x']").count()).toBe(0);
  // The photo URL is encoded, not a path walk.
  const srcs = await page
    .locator("main img")
    .evaluateAll((els) => els.map((e) => e.getAttribute("src")));
  for (const s of srcs) expect(s ?? "").not.toContain("../");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await axe(page);
});

test("a server 422 puts each message next to its input and focus on the first in form order", async ({
  page,
}) => {
  await setup(page, (route) =>
    err(route, 422, "VALIDATION_FAILED", {
      date: "Pick a date from today to 180 days ahead.",
      maxRateCents: "The highest rate must not be below the lowest.",
      city: "Not a GTA city.",
    }),
  );
  await find(page);
  const city = page.getByLabel("Or a city");
  await expect(city).toBeFocused();
  await expect(city).toHaveAttribute("aria-invalid", "true");
  await expect(city).toHaveAccessibleDescription(/Not a GTA city/);
  await expect(
    page.getByLabel("Highest hourly rate ($)"),
  ).toHaveAccessibleDescription(/must not be below/);
  await expect(
    page.getByLabel("Day you need a chef (optional)"),
  ).toHaveAccessibleDescription(/Pick a date/);
  await expect(
    page.getByRole("alert").filter({ hasText: "Check the highlighted" }),
  ).toBeVisible();
  await axe(page);
});

test("a 422 with only a field the form does not show (cursor, locationType) says so and focuses the alert", async ({
  page,
}) => {
  await setup(page, (route) =>
    err(route, 422, "VALIDATION_FAILED", {
      cursor: "That page marker is not valid.",
    }),
  );
  await find(page);
  const alert = page.getByRole("alert").filter({ hasText: "not valid" });
  await expect(alert).toBeFocused();
  await expect(results(page)).toHaveCount(0);
});

test("a failed search: message with focus, earlier results are cleared, the form keeps its values, and a retry recovers", async ({
  page,
}) => {
  let mode: "ok" | "500" | "abort" = "ok";
  await setup(page, (route) => {
    if (mode === "500") return err(route, 500, "INTERNAL");
    if (mode === "abort") return route.abort();
    return ok(route, { items: [item(1), item(2)], nextCursor: null });
  });
  await page.getByLabel("Cuisine").fill("Vietnamese");
  await find(page);
  await expect(results(page)).toHaveCount(2);

  mode = "500";
  await find(page);
  const alert = page.getByRole("alert").filter({ hasText: "not working" });
  await expect(alert).toBeFocused();
  await expect(results(page)).toHaveCount(0);
  await expect(page.getByLabel("Cuisine")).toHaveValue("Vietnamese");
  await expect(page.getByTestId("results-status")).toHaveText("");
  await axe(page);

  mode = "abort";
  await find(page);
  await expect(
    page.getByRole("alert").filter({ hasText: /Could not reach the server/ }),
  ).toBeFocused();

  mode = "ok";
  await find(page);
  await expect(results(page)).toHaveCount(2);
  await expect(page.getByText(/not working|Could not reach/)).toHaveCount(0);
});

test("Load more: a failed page keeps the list and the button, a retry works, repeats are dropped, focus goes to the first new chef", async ({
  page,
}) => {
  const seen: string[] = [];
  let failNext = true;
  await setup(page, (route, url) => {
    seen.push(url.search);
    const cursor = url.searchParams.get("cursor");
    if (!cursor)
      return ok(route, {
        items: [item(1), item(2), item(3)],
        nextCursor: "c1",
      });
    if (failNext) {
      failNext = false;
      return err(route, 500, "INTERNAL");
    }
    // Chef 3 shows up again (a chef moved between pages): it must not appear twice.
    return ok(route, { items: [item(3), item(4)], nextCursor: null });
  });
  await page.getByLabel("Cuisine").fill("Vietnamese");
  await find(page);
  await expect(results(page)).toHaveCount(3);

  // The form changes after the search; paging must still use the submitted search.
  await page.getByLabel("Cuisine").fill("Italian");
  const more = page.getByRole("button", { name: "Load more" });
  await more.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "not working" }),
  ).toBeVisible();
  await expect(results(page)).toHaveCount(3);
  await expect(more).toBeVisible();

  await more.click();
  await expect(results(page)).toHaveCount(4);
  await expect(results(page).nth(3).getByRole("link")).toBeFocused();
  await expect(page.getByText(/not working/)).toHaveCount(0);
  await expect(more).toHaveCount(0);
  await expect(page.getByTestId("results-status")).toHaveText(
    "Showing 4 chefs.",
  );
  const paged = seen.filter((s) => s.includes("cursor=c1"));
  expect(paged).toHaveLength(2);
  for (const s of paged) {
    expect(s).toContain("cuisine=Vietnamese");
    expect(s).not.toContain("Italian");
  }
  await axe(page);
});

test("a page that is all repeats does not break the list or focus", async ({
  page,
}) => {
  await setup(page, (route, url) =>
    url.searchParams.get("cursor")
      ? ok(route, { items: [item(1)], nextCursor: null })
      : ok(route, { items: [item(1), item(2)], nextCursor: "c1" }),
  );
  await find(page);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
  await expect(results(page)).toHaveCount(2);
  await expect(page.getByTestId("results-status")).toHaveText(
    "Showing 2 chefs.",
  );
});

test("a slow Load more of an old list is dropped when a newer search replaces it", async ({
  page,
}) => {
  await setup(page, async (route, url) => {
    const cuisine = url.searchParams.get("cuisine");
    if (url.searchParams.get("cursor"))
      await new Promise((r) => setTimeout(r, 1200));
    return ok(route, {
      items: [item(1, { displayName: `Fast ${cuisine ?? "all"}` })],
      nextCursor: url.searchParams.get("cursor") ? null : "c1",
    });
  });
  await page.getByLabel("Cuisine").fill("fast");
  await find(page);
  await expect(results(page).first()).toContainText("Fast fast");
  await page.getByRole("button", { name: "Load more" }).click();
  // While the second page is slow, a new search replaces the list.
  await page.getByLabel("Cuisine").fill("newer");
  await page.getByLabel("Cuisine").press("Enter");
  await expect(results(page).first()).toContainText("Fast newer");
  await page.waitForTimeout(1500);
  await expect(results(page)).toHaveCount(1);
  await expect(results(page).first()).toContainText("Fast newer");
});

test("pins: one per city; chefs in a city missing from the list or with no city have no pin but stay in the list", async ({
  page,
}) => {
  await setup(page, (route) =>
    ok(route, {
      items: [
        item(1, { serviceCity: "Mississauga" }),
        item(2, { serviceCity: "mississauga" }),
        item(3, { serviceCity: "Toronto" }),
        item(4, { serviceCity: "Atlantis" }),
        item(5, { serviceCity: null, distanceKm: null }),
        item(6, {
          serviceCity: "Richmond Hill",
          chefHomeOnly: true,
          locationOptions: ["chef_home"],
        }),
      ],
      nextCursor: null,
    }),
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await find(page);
  await expect(results(page)).toHaveCount(6);
  const pins = page
    .getByTestId("chef-map")
    .getByRole("button", { name: /chefs?\. Press Enter/ });
  await expect(pins).toHaveCount(3);
  await expect(
    page
      .getByTestId("chef-map")
      .getByRole("button", { name: /^Mississauga: 2 chefs\./ }),
  ).toBeVisible();
  // "Show on map" only where a pin can exist.
  await expect(
    results(page)
      .nth(4)
      .getByRole("button", { name: /Show on map/ }),
  ).toHaveCount(0);
  await expect(results(page).nth(5).getByTestId("chef-home-only")).toHaveText(
    "Chef's home only",
  );
  // A chef who has no city says nothing about where they work.
  await expect(results(page).nth(4)).not.toContainText("Works around");
  await axe(page);
});

test("the map can't be set up without the city list: a clear note, the list is untouched", async ({
  page,
}) => {
  await page.route("**/api/reference/postal-prefixes", (r) => r.abort());
  await page.route("**/storage/v1/**", (r) => r.abort());
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/chefs")
      return ok(route, { items: [item(1)], nextCursor: null });
    return err(route, 401, "UNAUTHENTICATED");
  });
  await page.goto("/search");
  await page.setViewportSize({ width: 1280, height: 900 });
  await find(page);
  await expect(results(page)).toHaveCount(1);
  await expect(page.getByText("The map could not be set up.")).toBeVisible();
  await expect(page.getByTestId("chef-map")).toHaveCount(0);
  await axe(page);
});

test("on a phone the map is not in the page until it is asked for", async ({
  page,
}) => {
  await setup(page, (route) =>
    ok(route, { items: [item(1)], nextCursor: null }),
  );
  await page.setViewportSize({ width: 375, height: 800 });
  await page.reload();
  await find(page);
  await expect(results(page)).toHaveCount(1);
  await expect(page.locator(".leaflet-container")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show map" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

test("an empty answer shows the empty state; a wide screen opens the map only when there are results", async ({
  page,
}) => {
  await setup(page, (route) => ok(route, { items: [], nextCursor: null }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await find(page);
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(page.getByTestId("chef-map")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /map/i })).toHaveCount(0);
  await axe(page);
});
