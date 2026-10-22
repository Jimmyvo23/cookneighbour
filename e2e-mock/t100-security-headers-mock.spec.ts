import { expect, test } from "@playwright/test";
import { PNG, blockStorage } from "./helpers";

// T-100: every page carries the security headers, and the map, photos and fonts still load
// without a CSP violation in the console.
test("page response carries the security headers", async ({ request }) => {
  const res = await request.get("/");
  const h = res.headers();
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["permissions-policy"]).toBe(
    "camera=(), microphone=(), geolocation=()",
  );
  expect(h["x-powered-by"]).toBeUndefined();
  const csp = h["content-security-policy"];
  for (const d of [
    "frame-ancestors 'none'",
    "default-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ])
    expect(csp).toContain(d);
});

test("search page and map render with no CSP violation", async ({ page }) => {
  await blockStorage(page);
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: PNG.buffer }),
  );
  const problems: string[] = [];
  page.on("console", (m) => {
    if (/content security policy|refused to/i.test(m.text()))
      problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto("/search");
  await expect(page.getByLabel("Or a city")).toBeEnabled();
  await page.getByLabel("Or a city").selectOption("Mississauga");
  await page.getByRole("button", { name: "Find chefs" }).click();
  await expect(page.getByTestId("chef-result").first()).toBeVisible();
  // OpenStreetMap tiles are allowed by img-src.
  await expect(
    page.getByTestId("chef-map").locator(".leaflet-tile-loaded").first(),
  ).toBeVisible();
  expect(problems).toEqual([]);
});
