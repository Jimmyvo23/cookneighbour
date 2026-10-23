import { expect, test, type Page } from "@playwright/test";
import {
  PNG,
  blockStorage,
  hideDevOverlay,
  signUpChef,
  signUpCustomer,
} from "./helpers";

// T-069 fix round 1 (MOCK mode). M1: Tab order on /search matches what users see. L1: decorative loops stop.
test.beforeEach(async ({ page }) => {
  await hideDevOverlay(page);
  await blockStorage(page);
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: PNG.buffer }),
  );
});

async function openSearch(page: Page) {
  await page.goto("/search");
  await expect(
    page.getByRole("heading", { level: 1, name: "Find a home cook" }),
  ).toBeVisible();
  await expect(page.getByLabel("Or a city")).toBeEnabled();
}

for (const width of [375, 1280]) {
  test(`Tab order on /search follows the visual order at ${width} px (MOCK)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openSearch(page);
    await page.getByLabel("Postal code").focus();
    // Record the position of every Tab stop inside the form until Find chefs.
    const stops: { y: number; x: number; name: string }[] = [];
    for (let i = 0; i < 40; i++) {
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const r = el.getBoundingClientRect();
        return {
          y: r.top + window.scrollY,
          x: r.left,
          name: el.textContent?.trim() || el.getAttribute("name") || el.id,
          inForm: !!el.closest("form"),
        };
      });
      if (!info.inForm) break;
      stops.push(info);
      if (info.name === "Find chefs") break;
      await page.keyboard.press("Tab");
    }
    expect(stops.at(-1)?.name).toBe("Find chefs");
    // Phone: one column, so every stop is at or below the one before it. Wide: the filters sit in
    // two columns (left column first), so only "the button is the last stop" is checked there.
    if (width < 1024) {
      for (let i = 1; i < stops.length; i++) {
        expect(
          stops[i].y,
          `${stops[i - 1].name} -> ${stops[i].name}`,
        ).toBeGreaterThanOrEqual(stops[i - 1].y - 40);
      }
    }
    if (width < 1024) {
      // On a phone the button is the lowest stop (the form's last control).
      const maxY = Math.max(...stops.map((s) => s.y));
      expect(stops.at(-1)!.y).toBe(maxY);
    }
  });
}

test("decorative animations are finite (MOCK)", async ({ page }) => {
  await openSearch(page);
  const infinite = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.effect?.getComputedTiming().iterations === Infinity)
      .map((a) => (a as CSSAnimation).animationName),
  );
  expect(infinite).toEqual([]);
});

test("availability day buttons are at least 44 px at 375 px (MOCK)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signUpChef(page, "Mai Tran");
  await page.getByRole("link", { name: "Availability" }).click();
  await expect(page.getByRole("grid")).toBeVisible();
  const days = await page.locator("button[data-day]").evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return [r.width, r.height];
    }),
  );
  expect(days.length).toBeGreaterThan(0);
  for (const [w, h] of days) {
    expect(w).toBeGreaterThanOrEqual(43.5);
    expect(h).toBeGreaterThanOrEqual(43.5);
  }
});

test("allergy checkbox rows are at least 44 px at 375 px (MOCK)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signUpCustomer(page);
  await page.goto("/allergies");
  const boxes = page.getByRole("checkbox");
  await expect(boxes.first()).toBeVisible();
  const rows = await boxes.evaluateAll((els) =>
    els.map((e) => {
      const l = (e as HTMLInputElement).labels?.[0];
      const r = l!.getBoundingClientRect();
      const c = e.parentElement!.getBoundingClientRect();
      return Math.max(r.height, c.height);
    }),
  );
  expect(rows.length).toBeGreaterThan(0);
  for (const h of rows) expect(h).toBeGreaterThanOrEqual(43.5);
});
