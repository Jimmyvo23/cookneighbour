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

/**
 * Signs up a customer in MOCK mode. With `verified` (default) the phone is verified and a home
 * address saved, so the free first booking is available; without it the customer stops after
 * sign-up (no phone, no address).
 */
export async function signUpCustomer(
  page: Page,
  opts: { verified?: boolean; name?: string } = {},
) {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill(opts.name ?? "Sam Customer");
  await page.getByLabel("Email").fill("sam@example.com");
  await page.getByLabel("Password").fill("longenough1");
  await page.getByRole("radio", { name: /customer/ }).check();
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/verify-phone$/);
  if (opts.verified === false) return;
  await page.getByLabel("Mobile phone number").fill("416 555 0123");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/address$/);
  await page.getByLabel("Street address").fill("1 Main St");
  await page.getByLabel("City").fill("Mississauga");
  await page.getByLabel("Postal code").fill("L5B 1M2");
  await page.getByRole("button", { name: "Save address" }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** Sets MOCK test hooks of the booking routes (see src/lib/mocks/mock-bookings.ts). */
export async function setMockHooks(page: Page, hooks: Record<string, unknown>) {
  await page.evaluate((h) => {
    const key = "cookneighbour-mock-api-state";
    const state = JSON.parse(sessionStorage.getItem(key) ?? "{}");
    state.hooks = { ...(state.hooks ?? {}), ...h };
    sessionStorage.setItem(key, JSON.stringify(state));
  }, hooks);
}

/** The Toronto calendar date `n` days from today, YYYY-MM-DD (the rule the app uses, not the browser clock). */
export function dayPlus(n: number): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Logs in to the MOCK adapter as the demo chef (an email starting "chef"). */
export async function loginChef(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("chef@example.com");
  await page.getByLabel("Password").fill("longenough1");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

/** Logs in to the MOCK adapter as the demo customer (any other email). */
export async function loginCustomer(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("sam@example.com");
  await page.getByLabel("Password").fill("longenough1");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

/**
 * Receipts are private files in a Supabase bucket. A MOCK page must never ask any storage URL for
 * one (T-045): this blocks every storage request and returns the list of those that were tried.
 */
export async function blockAllStorage(page: Page): Promise<string[]> {
  const tried: string[] = [];
  await page.route("**/storage/v1/**", (route) => {
    tried.push(route.request().url());
    return route.abort();
  });
  return tried;
}

/** The element with this test id that is showing (earlier pages stay mounted but hidden). */
export function vis(page: Page, testId: string) {
  return page.getByTestId(testId).filter({ visible: true });
}

/** Opens the page and hides the Next.js dev overlay, which would sit over buttons at the bottom. */
export async function openPage(page: Page, path: string) {
  await page.goto(path);
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
}

/** Shows the made-up bookings to a customer (MOCK hook; see src/lib/mocks/mock-booking-changes.ts). */
export async function seedCustomerBookings(page: Page) {
  await setMockHooks(page, { seedCustomer: true });
  // The first booking call brings the bookings in; wait for it so a test can then edit them.
  await page.goto("/bookings");
  await expect(page.getByTestId("booking-item").first()).toBeVisible();
}

/** The seeded booking ids (src/lib/mocks/mock-booking-changes.ts). */
export const SEEDED = {
  A01: "00000000-0000-4000-8000-000000009101", // requested, customer's home, allergy conflict
  A02: "00000000-0000-4000-8000-000000009102", // requested, chef's home, chef shops
  A03: "00000000-0000-4000-8000-000000009103", // accepted, chef's home, open pickup proposal
  A04: "00000000-0000-4000-8000-000000009104", // accepted, customer's home, chef shops, today
  A05: "00000000-0000-4000-8000-000000009105", // accepted, chef's home, pickup window over
  A06: "00000000-0000-4000-8000-000000009106", // accepted, customer's home, flagged receipt
};

/** True when the page scrolls sideways (it must not at 375 px). */
export async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1,
  );
}

/**
 * Edits the saved MOCK state of this tab (sessionStorage) from a test, for states the UI cannot
 * reach alone in mock mode. `edit` runs in the page, so it can use only its argument.
 */
export async function editMockState<A>(
  page: Page,
  edit: (state: Record<string, any>, arg: A) => void, // eslint-disable-line @typescript-eslint/no-explicit-any
  arg?: A,
) {
  await page.evaluate(
    ([src, a]) => {
      const key = "cookneighbour-mock-api-state";
      const state = JSON.parse(sessionStorage.getItem(key) ?? "{}");
      new Function(`return (${src})`)()(state, a);
      sessionStorage.setItem(key, JSON.stringify(state));
    },
    [edit.toString(), arg] as const,
  );
}
