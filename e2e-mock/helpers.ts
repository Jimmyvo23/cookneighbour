import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export const PNG = {
  name: "dish.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
};

/** Signs up a chef in MOCK mode and lands on /chef/apply. */
export async function signUpChef(page: Page, name: string) {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill("chef@example.com");
  await page.getByLabel("Password").fill("longenough1");
  await page.getByRole("radio", { name: /chef/ }).check();
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/verify-phone$/);
  await page.getByLabel("Mobile phone number").fill("416 555 0123");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/address$/);
  await page.getByLabel("Street address").fill("1 Main St");
  await page.getByLabel("City").fill("Mississauga");
  await page.getByLabel("Postal code").fill("L5B 1M2");
  await page.getByRole("button", { name: "Save address" }).click();
  await expect(page).toHaveURL(/\/chef\/apply$/);
  await expect(page.getByText("Loading your application")).toHaveCount(0);
}

export async function expectNoAxeViolations(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
}

/** Logs in to the MOCK adapter as the demo admin (an email starting "admin") and lands on the queue. */
export async function loginAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@example.com");
  await page.getByLabel("Password").fill("longenough1");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/admin\/chefs$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Chef applications" }),
  ).toBeVisible();
  await expect(page.getByTestId("queue-count")).toBeVisible();
}

/** Opens one chef from the queue by clicking their name (the list has to be showing them). */
export async function openChef(page: Page, name: string) {
  await page.getByRole("link", { name: `${name} (open application)` }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Review chef application" }),
  ).toBeVisible();
  // Earlier pages stay mounted but hidden (cacheComponents): look only at the one showing.
  await expect(
    page.getByTestId("chef-status").filter({ visible: true }),
  ).toBeVisible();
}

/**
 * MOCK photo paths are made up. A developer's .env.local must never make a mock page ask hosted
 * storage for them (T-040), so every mock spec that renders photos calls this in `beforeEach`.
 * Returns the list that collects any request that was blocked (a spec may assert it is empty).
 */
export async function blockStorage(page: Page): Promise<string[]> {
  const blocked: string[] = [];
  await page.route("**/storage/v1/object/public/**", (route) => {
    blocked.push(route.request().url());
    return route.abort();
  });
  return blocked;
}
