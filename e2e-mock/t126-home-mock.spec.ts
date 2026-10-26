import { expect, test } from "@playwright/test";
import {
  expectNoAxeViolations,
  hideDevOverlay,
  scrollsSideways,
} from "./helpers";

// T-126 v2, MOCK mode: the new home page (words, map, table). The pots are DEMO data; in MOCK mode
// the card link always goes to /search. Everything is made up.
test.beforeEach(async ({ page }) => {
  await hideDevOverlay(page);
});

test("home hero copy", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Miss your mom's cooking?",
  );
  await expect(page.getByText("PROTOTYPE", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Find a home cook" }),
  ).toHaveAttribute("href", "/search");
  await expect(
    page.getByRole("link", { name: "I love to cook" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "I love to cook" }),
  ).toHaveAttribute("href", "/signup");
});

test("phone order 375: words, then map, then table", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  const y = async (sel: string) => (await page.locator(sel).boundingBox())!.y;
  const copy = await y(".home-copy");
  const map = await y(".home-map");
  const table = await y(".home-table");
  expect(copy).toBeLessThan(map);
  expect(map).toBeLessThan(table);
});

test("no sideways scroll at 320", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  await page.getByRole("button", { name: /Pho bo/ }).click();
  expect(await scrollsSideways(page)).toBe(false);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
});

test("desktop puts the table under the words, map on the right, DOM order kept", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
  const table = await box(".home-table");
  const copy = await box(".home-copy");
  const map = await box(".home-map");
  expect(table.y).toBeGreaterThan(copy.y);
  expect(Math.abs(table.x - copy.x)).toBeLessThan(40);
  expect(map.x).toBeGreaterThan(copy.x);
  const dom = await page.evaluate(() =>
    Array.from(document.querySelector(".home-hero")!.children).map(
      (c) => c.className,
    ),
  );
  expect(dom).toEqual(["home-copy", "home-map", "home-table"]);
  // Nothing may reorder the children visually.
  const orders = await page.evaluate(() =>
    Array.from(document.querySelector(".home-hero")!.children).map(
      (c) => getComputedStyle(c).order,
    ),
  );
  expect(orders).toEqual(["0", "0", "0"]);
});

test("keyboard opens pots", async ({ page }) => {
  await page.goto("/");
  const find = page.getByRole("link", { name: "Find a home cook" });
  const love = page.getByRole("link", { name: "I love to cook" });
  const miss = page.getByRole("button", { name: /Pho bo by Chef Lan/ });
  await find.focus();
  await page.keyboard.press("Tab");
  await expect(love).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(miss).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("pot-card")).toContainText("Pho bo");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: /Chole and roti/ }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: /Brown stew fish/ }),
  ).toBeFocused();
});

test("hover and click open a pot, one at a time", async ({ page }) => {
  await page.goto("/");
  const card = page.getByTestId("pot-card");
  await expect(card).toContainText("Neighbours are cooking.");
  await page.getByRole("button", { name: /Chole and roti/ }).hover();
  await expect(card).toContainText("Chole and roti");
  await page.getByRole("button", { name: /Brown stew fish/ }).click();
  await expect(card).toContainText("Brown stew fish");
  await expect(card).toContainText("DEMO");
  await expect(page.locator(".pot-btn.is-open")).toHaveCount(1);
});

test("mock mode falls back to search", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Pho bo by Chef Lan/ }).click();
  await expect(page.getByTestId("pot-card").getByRole("link")).toHaveAttribute(
    "href",
    "/search?city=Mississauga&cuisine=Vietnamese",
  );
  await expect(page.getByTestId("pot-card").getByRole("link")).toHaveText(
    "Find a Vietnamese cook",
  );
});

test("reduced motion: the lid does not animate", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: /Pho bo by Chef Lan/ }).click();
  const dur = await page
    .locator(".pot-btn.is-open .pot-art-lid")
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(dur).toBe("0s");
});

for (const width of [320, 375, 768, 1024, 1280]) {
  test(`the card keeps one height for every pot, ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    const card = page.getByTestId("pot-card");
    const heights = [(await card.boundingBox())!.height];
    for (const name of [/Pho bo/, /Chole and roti/, /Brown stew fish/]) {
      await page.getByRole("button", { name }).click();
      await expect(card.getByRole("link")).toBeVisible();
      await page.waitForTimeout(300);
      heights.push((await card.boundingBox())!.height);
    }
    expect(new Set(heights.map(Math.round)).size).toBe(1);
  });
}

test("pots have 44 px targets", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  for (const b of await page.locator(".pot-btn").all()) {
    const box = (await b.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(43.5);
    expect(box.height).toBeGreaterThanOrEqual(43.5);
  }
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe: home and search, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await page.getByRole("button", { name: /Pho bo by Chef Lan/ }).click();
    await expectNoAxeViolations(page);
    await page.goto("/search");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("search: the hero text is not covered by the search card", async ({
  page,
}) => {
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/search");
    await expect(page.locator(".hero p").last()).toBeVisible();
    const textBottom = await page
      .locator(".hero p")
      .last()
      .evaluate((el) => el.getBoundingClientRect().bottom);
    const cardTop = await page
      .locator(".recipe-card")
      .first()
      .evaluate((el) => el.getBoundingClientRect().top);
    expect(textBottom).toBeLessThanOrEqual(cardTop);
  }
});

test("the headline fits on at most two lines at 1280", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const h = await page.getByRole("heading", { level: 1 }).evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      height: el.getBoundingClientRect().height,
      line: parseFloat(cs.lineHeight),
    };
  });
  expect(h.height).toBeLessThanOrEqual(h.line * 2 + 1);
});

test("the pot link opens search with the city and cuisine filled and results loaded", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Pho bo by Chef Lan/ }).click();
  await page.getByTestId("pot-card").getByRole("link").click();
  await expect(page).toHaveURL(/\/search\?city=Mississauga&cuisine=Vietnamese/);
  await expect(page.getByLabel("Or a city")).toHaveValue("Mississauga");
  await expect(page.getByLabel("Cuisine")).toHaveValue("Vietnamese");
  await expect(
    page.getByText('Press "Find chefs" to see results.'),
  ).toHaveCount(0);
  await expect(
    page.getByRole("listitem").filter({ hasText: "Mai Tran" }).first(),
  ).toBeVisible();
});

test("search ignores a bad city or cuisine in the link, with no error", async ({
  page,
}) => {
  await page.goto("/search?city=Atlantis&cuisine=%00");
  await expect(page.getByLabel("Or a city")).toHaveValue("");
  await expect(page.getByLabel("Cuisine")).toHaveValue("");
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(
    0,
  );
});

test("dark mode: the open Mississauga pot is visible against the map", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.getByRole("button", { name: /Pho bo by Chef Lan/ }).click();
  const fills = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return ["--pot-lid-red", "--pot-bubble-bg", "--map-shadow"].map((n) =>
      cs.getPropertyValue(n).trim(),
    );
  });
  expect(fills).toEqual(["#b8603f", "#f5e9dc", "#3a2c22"]);
});
