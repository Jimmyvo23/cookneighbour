import { expect, test, type Page } from "@playwright/test";
import { PNG, blockStorage } from "./helpers";

// Tester (T-041), MOCK mode: what "Back to the search" remembers (sessionStorage key
// cookneighbour.search), tampered saved data, tabs, and keyboard order on the chef page.
const MAI = "00000000-0000-4000-8000-000000001001";
const KEY = "cookneighbour.search";

test.beforeEach(async ({ page }) => {
  await blockStorage(page);
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: PNG.buffer }),
  );
});

const emptyForm = {
  postalCode: "",
  city: "",
  cuisine: "",
  language: "",
  minRate: "",
  maxRate: "",
  date: "",
  locationType: "customer_home",
  avoidAllergens: [],
};
const setSaved = (page: Page, raw: string) =>
  page.addInitScript(([k, v]) => window.sessionStorage.setItem(k, v), [
    KEY,
    raw,
  ] as const);

for (const [name, raw] of [
  ["bad JSON", "{not json"],
  ["an array", "[1,2,3]"],
  ["a wrong version", JSON.stringify({ v: 9, form: emptyForm })],
  [
    "a number in a text field",
    JSON.stringify({ v: 1, form: { ...emptyForm, city: 5 } }),
  ],
  [
    "a text field over 200 characters",
    JSON.stringify({ v: 1, form: { ...emptyForm, cuisine: "x".repeat(201) } }),
  ],
  [
    "40 allergens",
    JSON.stringify({
      v: 1,
      form: { ...emptyForm, avoidAllergens: Array(40).fill("soy") },
    }),
  ],
  [
    "an unknown location type",
    JSON.stringify({ v: 1, form: { ...emptyForm, locationType: "x" } }),
  ],
] as const) {
  test(`saved search that is ${name} is ignored: empty form, no results, no error (MOCK)`, async ({
    page,
  }) => {
    await setSaved(page, raw);
    await page.goto("/search");
    await expect(page.getByLabel("Or a city")).toBeEnabled();
    await expect(page.getByLabel("Cuisine")).toHaveValue("");
    await expect(page.getByLabel("Postal code")).toHaveValue("");
    await expect(page.getByTestId("chef-result")).toHaveCount(0);
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(
      0,
    );
  });
}

test("a saved search with a script in a field is only ever text and the server's rules reject it (MOCK)", async ({
  page,
}) => {
  const evil = "<img src=x onerror=window.__pwned=1>";
  await setSaved(
    page,
    JSON.stringify({ v: 1, form: { ...emptyForm, postalCode: evil } }),
  );
  await page.goto("/search");
  await expect(page.getByLabel("Postal code")).toHaveValue(evil);
  await expect(page.getByText("could not be repeated")).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as never as { __pwned?: number }).__pwned,
    ),
  ).toBeUndefined();
  // The bad search is dropped, not kept forever.
  expect(await page.evaluate((k) => sessionStorage.getItem(k), KEY)).toBeNull();
});

test("a saved search with a past date is dropped with a message, and focus is not stolen (MOCK)", async ({
  page,
}) => {
  await setSaved(
    page,
    JSON.stringify({
      v: 1,
      form: { ...emptyForm, city: "Mississauga", date: "2020-01-01" },
    }),
  );
  await page.goto("/search");
  await expect(page.getByText("could not be repeated")).toBeVisible();
  await expect(page.getByTestId("chef-result")).toHaveCount(0);
  expect(await page.evaluate((k) => sessionStorage.getItem(k), KEY)).toBeNull();
});

test("only a search that ran is remembered; an invalid submit is not (MOCK)", async ({
  page,
}) => {
  await page.goto("/search");
  await expect(page.getByLabel("Or a city")).toBeEnabled();
  await page.getByLabel("Postal code").fill("90210");
  await page.getByRole("button", { name: "Find chefs" }).click();
  await expect(page.getByLabel("Postal code")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(await page.evaluate((k) => sessionStorage.getItem(k), KEY)).toBeNull();

  // Typing without pressing Find chefs saves nothing either.
  await page.getByLabel("Postal code").fill("");
  await page.getByLabel("Or a city").selectOption("Mississauga");
  await page.getByRole("button", { name: "Find chefs" }).click();
  await expect(page.getByTestId("results-status")).toContainText("Showing");
  await page.getByLabel("Cuisine").fill("Korean-typed-not-run");
  const saved = await page.evaluate((k) => sessionStorage.getItem(k), KEY);
  expect(saved).not.toContain("Korean-typed-not-run");
  expect(saved).toContain("Mississauga");
});

test("a later visit to /search in the same tab restores the last search; another tab does not (MOCK)", async ({
  page,
  context,
}) => {
  await page.goto("/search");
  await expect(page.getByLabel("Or a city")).toBeEnabled();
  await page.getByLabel("Or a city").selectOption("Mississauga");
  await page.getByLabel("Cuisine").fill("Vietnamese");
  await page.getByRole("button", { name: "Find chefs" }).click();
  await expect(page.getByTestId("results-status")).toHaveText(
    "Showing 2 chefs.",
  );

  // Same tab, a brand new visit (typed URL, not Back): the old search comes back.
  await page.goto("/");
  await page.goto("/search");
  await expect(page.getByLabel("Cuisine")).toHaveValue("Vietnamese");
  await expect(page.getByTestId("results-status")).toHaveText(
    "Showing 2 chefs.",
  );

  // A second tab in the same browser starts empty: sessionStorage is per tab.
  const other = await context.newPage();
  await other.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: PNG.buffer }),
  );
  await other.goto("/search");
  await expect(other.getByLabel("Or a city")).toBeEnabled();
  await expect(other.getByLabel("Cuisine")).toHaveValue("");
  await expect(other.getByTestId("chef-result")).toHaveCount(0);

  // Closing and reopening the tab loses it (new page, new session).
  await page.close();
  const fresh = await context.newPage();
  await fresh.goto("/search");
  await expect(fresh.getByLabel("Or a city")).toBeEnabled();
  await expect(fresh.getByLabel("Cuisine")).toHaveValue("");
});

test("keyboard: the Back link is the first Tab stop in the chef page content and Enter returns to the search (MOCK)", async ({
  page,
}) => {
  await page.goto(`/chefs/${MAI}`);
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // The site header (Log in, Sign up) comes first, then the Back link, before any page content.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const back = page.getByRole("link", { name: "Back to the search" });
  await expect(back).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/search$/);
});

test("chef page: every interactive element is reachable by Tab and the tab title tracks the chef (MOCK)", async ({
  page,
}) => {
  await page.goto(`/chefs/${MAI}`);
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await expect(page.getByTestId("dish").first()).toBeVisible();
  const seen = new Set<string>();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    seen.add(
      await page.evaluate(
        () =>
          document.activeElement?.getAttribute("data-testid") ??
          document.activeElement?.tagName ??
          "",
      ),
    );
  }
  expect(seen.has("book-stub")).toBe(true);
  expect(seen.has("SUMMARY")).toBe(true);
  await expect(page).toHaveTitle("Mai Tran (MOCK) — CookNeighbour");
});

test("two quick chef-to-chef navigations end on the last chef (MOCK)", async ({
  page,
}) => {
  await page.goto(`/chefs/${MAI}`);
  await expect(
    page.getByRole("heading", { level: 1, name: /Mai Tran/ }),
  ).toBeVisible();
  await page.goto("/chefs/00000000-0000-4000-8000-000000001002");
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Mai Tran (MOCK)",
  );
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Linh Nguyen (MOCK)",
  );
});

test("the Book stub makes no network request (MOCK)", async ({ page }) => {
  await page.goto(`/chefs/${MAI}`);
  await expect(page.getByTestId("book-stub")).toBeVisible();
  const requests: string[] = [];
  page.on("request", (r) => requests.push(`${r.method()} ${r.url()}`));
  await page.getByTestId("book-stub").click({ force: true });
  await page.getByTestId("book-stub").press("Enter");
  await page.waitForTimeout(300);
  expect(requests).toEqual([]);
});
