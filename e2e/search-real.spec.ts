import AxeBuilder from "@axe-core/playwright";
import {
  test as base,
  expect,
  type APIRequestContext,
  type APIResponse,
  type Page,
  type PlaywrightWorkerArgs,
} from "@playwright/test";
import { createLocalAdmin } from "./helpers/local-admin";
import { createSubmittedChef, uniq } from "./helpers/local-chef";

// T-040: the customer search page against the REAL /api routes and a throwaway local Supabase
// (see playwright.config.ts). CLAUDE.md section 12, demo step 1: a customer searches Mississauga
// for a Vietnamese chef and finds one. The chefs are created through the real routes and approved
// by a real (local) admin; every check the admin records is a MOCK outcome.
const json = { "Content-Type": "application/json" };
const o = () => Math.floor(Math.random() * 254) + 1;
const randomIp = () => `10.${o()}.${o()}.${o()}`;
const test = base.extend({
  extraHTTPHeaders: async ({}, provide) => {
    await provide({ "x-forwarded-for": randomIp() });
  },
});

async function expectNoAxeViolations(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
}

async function newContext(
  playwright: PlaywrightWorkerArgs["playwright"],
  baseURL: string | undefined,
) {
  return playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { "x-forwarded-for": randomIp() },
  });
}

/** A signed-in local admin on its own cookie jar. */
async function adminContext(
  playwright: PlaywrightWorkerArgs["playwright"],
  baseURL: string | undefined,
) {
  const admin = await createLocalAdmin();
  const ctx = await newContext(playwright, baseURL);
  const r = await ctx.post("/api/auth/login", {
    headers: json,
    data: { email: admin.email, password: admin.password },
  });
  expect(r.status()).toBe(200);
  return ctx;
}

/** Verifies both file checks (MOCK) and approves the chef, as an admin would. */
async function approve(
  admin: APIRequestContext,
  chef: APIRequestContext,
  id: string,
) {
  const app = await (await chef.get("/api/chef/application")).json();
  const checks = await admin.patch(`/api/admin/chefs/${id}/checks`, {
    headers: json,
    data: {
      idCheck: "verified",
      idDocumentPath: app.documents.idDocumentPath,
      foodHandlerCheck: "verified",
      foodHandlerPath: app.documents.foodHandlerPath,
    },
  });
  expect(checks.status(), await checks.text()).toBe(200);
  const r = await admin.post(`/api/admin/chefs/${id}/approve`, {
    headers: json,
    data: {},
  });
  expect(r.status(), await r.text()).toBe(200);
}

/** The kitchen review (MOCK): turns on cooking at the chef's home. */
async function approveKitchen(
  admin: APIRequestContext,
  chef: APIRequestContext,
  id: string,
) {
  const app = await (await chef.get("/api/chef/application")).json();
  const r = await admin.post(`/api/admin/chefs/${id}/kitchen-review`, {
    headers: json,
    data: {
      decision: "approve",
      reviewedPhotoPaths: app.documents.kitchenPhotoPaths,
      reviewedAddress: app.kitchenAddress,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}

/** Gives the chef words only they have, so the search can single them out. */
async function tag(chef: APIRequestContext, tagWord: string) {
  const r = await chef.patch("/api/chef/application", {
    headers: json,
    data: {
      cuisines: ["Vietnamese", tagWord],
      languages: ["English", "Vietnamese", tagWord],
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}

/** Every name the public search returns for `qs`, page by page. */
async function allNames(page: Page, qs: string): Promise<string[]> {
  const names: string[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 30; i++) {
    const r: APIResponse = await page.request.get(
      `/api/chefs?${qs}&limit=50${cursor ? `&cursor=${cursor}` : ""}`,
    );
    expect(r.status()).toBe(200);
    const body: {
      items: { displayName: string }[];
      nextCursor: string | null;
    } = await r.json();
    names.push(
      ...body.items.map((x: { displayName: string }) => x.displayName),
    );
    cursor = body.nextCursor;
    if (!cursor) break;
  }
  return names;
}

/** Clicks "Load more" until the chef's link shows up (the list may be long). */
async function findInResults(page: Page, name: string) {
  const link = page.getByRole("link", { name, exact: true });
  for (let i = 0; i < 15 && !(await link.isVisible()); i++) {
    const more = page.getByRole("button", { name: "Load more" });
    if (!(await more.isVisible())) break;
    await more.click();
    await page.waitForTimeout(300);
  }
  return link;
}

async function openSearch(page: Page) {
  await page.goto("/search");
  await expect(
    page.getByRole("heading", { level: 1, name: "Find a home cook" }),
  ).toBeVisible();
}

test("a customer finds a Vietnamese chef in Mississauga; a pending chef is not listed (demo step 1)", async ({
  page,
  playwright,
  baseURL,
}) => {
  const chefCtx = await newContext(playwright, baseURL);
  const name = `E2E Search ${uniq()}`;
  const word = `Word${uniq()}`;
  const chef = await createSubmittedChef(chefCtx, name);
  await tag(chefCtx, word);

  // Pending: not in the public search, whatever the filters.
  expect(await allNames(page, "cuisine=Vietnamese")).not.toContain(name);

  const admin = await adminContext(playwright, baseURL);
  await approve(admin, chefCtx, chef.id);

  // A visitor (no account) searches by city and cuisine on the page.
  await openSearch(page);
  await expect(page.getByLabel("Or a city")).toBeEnabled();
  await page.getByLabel("Or a city").selectOption("Mississauga");
  await page.getByLabel("Cuisine").fill("Vietnamese");
  await page.getByRole("button", { name: "Find chefs" }).click();
  await expect(page.getByTestId("results-status")).toContainText("Showing");
  await expect(
    page.getByRole("heading", { level: 2, name: "Results" }),
  ).toBeFocused();
  // There are Vietnamese chefs in Mississauga (the demo seed adds some), and the new one is among them.
  const link = await findInResults(page, name);
  await expect(link).toBeVisible();
  const card = page.getByTestId("chef-result").filter({ has: link });
  await expect(card).toContainText("Cuisines: Vietnamese");
  await expect(card).toContainText("$30/hour");
  await expect(card).toContainText("Languages: English, Vietnamese");
  await expect(link).toHaveAttribute("href", `/chefs/${chef.id}`);

  // The uploaded profile picture really loads from storage.
  const img = card.getByRole("img", { name: `Photo of ${name}` });
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);

  // Narrow to exactly this chef with their own words, from a postal code (distance shown).
  await page.getByLabel("Or a city").selectOption("");
  await page.getByLabel("Postal code").fill("L5B 1A1");
  await page.getByLabel("Language the chef speaks (optional)").fill(word);
  await page.getByRole("button", { name: "Find chefs" }).click();
  await expect(page.getByTestId("results-status")).toHaveText(
    "Showing 1 chef.",
  );
  await expect(page.getByTestId("chef-result")).toContainText("0.0 km away");
  await expect(page.getByTestId("chef-home-only")).toHaveCount(0);
  await expectNoAxeViolations(page);

  // The result links to the chef page path.
  await page.getByRole("link", { name }).click();
  await expect(page).toHaveURL(new RegExp(`/chefs/${chef.id}$`));
  await expect(
    page.getByRole("heading", { level: 1, name, exact: true }),
  ).toBeVisible();

  // Back to the search keeps the filters (demo step 2 starts from this page).
  await page.getByRole("link", { name: "Back to the search" }).click();
  await expect(page.getByLabel("Postal code")).toHaveValue("L5B 1A1");
  await expect(
    page.getByLabel("Language the chef speaks (optional)"),
  ).toHaveValue(word);
  await expect(page.getByTestId("results-status")).toHaveText(
    "Showing 1 chef.",
  );

  await chefCtx.dispose();
  await admin.dispose();
});

test('a chef who can only be booked at their own kitchen is labelled "Chef\'s home only" when out of reach (A-18)', async ({
  page,
  playwright,
  baseURL,
}) => {
  const chefCtx = await newContext(playwright, baseURL);
  const name = `E2E Kitchen ${uniq()}`;
  const word = `Word${uniq()}`;
  const chef = await createSubmittedChef(chefCtx, name, { chefHome: true });
  await tag(chefCtx, word);
  const admin = await adminContext(playwright, baseURL);
  await approve(admin, chefCtx, chef.id);
  await approveKitchen(admin, chefCtx, chef.id);

  await openSearch(page);
  // Scarborough (M1B) is far outside this chef's 20 km radius around L5B.
  await page.getByLabel("Postal code").fill("M1B");
  await page.getByLabel("Language the chef speaks (optional)").fill(word);
  await page.getByRole("button", { name: "Find chefs" }).click();
  await expect(page.getByTestId("results-status")).toHaveText(
    "Showing 1 chef.",
  );
  await expect(page.getByTestId("chef-home-only")).toHaveText(
    "Chef's home only",
  );
  await expect(page.getByTestId("chef-result")).toContainText(name);

  // "At the chef's home" lists them too (no radius check there).
  await page.getByRole("radio", { name: "At the chef's home" }).check();
  await page.getByRole("button", { name: "Find chefs" }).click();
  await expect(page.getByTestId("results-status")).toHaveText(
    "Showing 1 chef.",
  );

  await expectNoAxeViolations(page);
  await chefCtx.dispose();
  await admin.dispose();
});

test("an empty result says so", async ({ page }) => {
  await openSearch(page);
  await page.getByLabel("Cuisine").fill(`Nothing${uniq()}`);
  await page.getByRole("button", { name: "Find chefs" }).click();
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(page.getByTestId("results-status")).toHaveText(
    "No chefs match this search.",
  );
  await expectNoAxeViolations(page);
});

test("the server's field errors show next to the input and focus goes there (list of cities unavailable)", async ({
  page,
}) => {
  // Without the city list the page cannot check the postal code itself: the server decides.
  await page.route("**/api/reference/postal-prefixes", (route) =>
    route.abort(),
  );
  await openSearch(page);
  await expect(page.getByLabel("Or a city")).toBeDisabled();
  await expect(
    page.getByText(
      "The list of cities could not be loaded. Use a postal code.",
    ),
  ).toBeVisible();

  await page.getByLabel("Postal code").fill("V6B 1A1");
  await page.getByRole("button", { name: "Find chefs" }).click();
  const postal = page.getByLabel("Postal code");
  await expect(postal).toBeFocused();
  await expect(postal).toHaveAttribute("aria-invalid", "true");
  await expect(postal).toHaveAccessibleDescription(/Not a GTA postal code/);
  await expectNoAxeViolations(page);

  // The list still works without the map's data.
  await postal.fill("");
  await page.getByRole("button", { name: "Find chefs" }).click();
  await expect(page.getByTestId("results-status")).toContainText(
    /Showing|No chefs/,
  );
  await expect(postal).not.toHaveAttribute("aria-invalid", "true");
});

test("a visitor opens an approved chef's page from the real route: profile, dishes, dates, no private data (T-041)", async ({
  page,
  playwright,
  baseURL,
}) => {
  const chefCtx = await newContext(playwright, baseURL);
  const name = `E2E Detail ${uniq()}`;
  const chef = await createSubmittedChef(chefCtx, name, { chefHome: true });
  const admin = await adminContext(playwright, baseURL);
  await approve(admin, chefCtx, chef.id);
  await approveKitchen(admin, chefCtx, chef.id);
  // Tick today and tomorrow (the server's Toronto days). D-27: no same-day bookings, so only
  // tomorrow is bookable and the page shows one available day.
  const win = await (await chefCtx.get("/api/chef/availability")).json();
  const tomorrow = new Date(`${win.today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const firstDay = tomorrow.toISOString().slice(0, 10);
  const put = await chefCtx.put("/api/chef/availability", {
    headers: json,
    data: { add: [win.today, firstDay] },
  });
  expect(put.status(), await put.text()).toBe(200);

  // A visitor with no account (no cookies) opens the page.
  await page.goto(`/chefs/${chef.id}`);
  await expect(
    page.getByRole("heading", { level: 1, name, exact: true }),
  ).toBeVisible();
  await expect(page.getByText("$30/hour")).toBeVisible();
  await expect(page.getByText("Cuisines: Vietnamese")).toBeVisible();
  await expect(page.getByText("I cook Vietnamese home food.")).toBeVisible();

  // Both cooking places, the kitchen check labelled MOCK.
  const where = page.getByRole("region", { name: "Where the chef can cook" });
  await expect(where.getByRole("listitem")).toHaveText([
    "At your home",
    "At the chef's home",
  ]);
  await expect(where.getByTestId("mock-badge")).toContainText("MOCK");

  // The seeded dish, with its really uploaded photo.
  const dish = page.getByTestId("dish");
  await expect(dish).toHaveCount(1);
  await expect(dish).toContainText("Pho");
  await expect(dish).toContainText("Cooking time: 2 h");
  await expect(dish.getByTestId("dish-allergens")).toContainText(
    "No allergens listed by the chef",
  );
  const img = dish.getByRole("img", { name: "Photo of Pho" });
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);

  // The ticked day inside the server's window.
  await expect(page.getByTestId("bookable-date")).toHaveCount(1);
  await expect(page.locator(`time[datetime="${firstDay}"]`)).toBeVisible();
  await expect(page.locator(`time[datetime="${win.today}"]`)).toHaveCount(0);

  // The Book entry point is a stub.
  await expect(page.getByTestId("book-stub")).toHaveAttribute(
    "aria-disabled",
    "true",
  );

  // Nothing private on the page: the kitchen address, the chef's email and the storage paths of
  // the private files are not in the text.
  const text = await page.locator("body").innerText();
  expect(text).not.toContain("1 Fictional Street");
  expect(text).not.toContain(chef.email);
  expect(text).not.toContain(chef.idPath);
  await expectNoAxeViolations(page);

  await chefCtx.dispose();
  await admin.dispose();
});

test("a pending chef's URL and an unknown or malformed id all show 'Chef not found' (T-041)", async ({
  page,
  playwright,
  baseURL,
}) => {
  const chefCtx = await newContext(playwright, baseURL);
  const chef = await createSubmittedChef(chefCtx, `E2E Pending ${uniq()}`);

  for (const id of [
    chef.id, // submitted, not approved
    crypto.randomUUID(),
    "not-a-uuid",
  ]) {
    await page.goto(`/chefs/${id}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Chef not found" }),
    ).toBeVisible();
    await expect(page.getByTestId("not-found")).toContainText(
      "We could not find this chef.",
    );
    await expect(page.getByTestId("dish")).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toContain(chef.name);
  }
  await expectNoAxeViolations(page);
  await chefCtx.dispose();
});

test("a rejected chef's URL shows 'Chef not found'; an approved chef whose kitchen is not reviewed opens with 'cannot be booked yet' (T-041 tester)", async ({
  page,
  playwright,
  baseURL,
}) => {
  const admin = await adminContext(playwright, baseURL);

  // Rejected: the same answer as an unknown chef, and the reason is never shown.
  const rejCtx = await newContext(playwright, baseURL);
  const rejected = await createSubmittedChef(rejCtx, `E2E Rejected ${uniq()}`);
  const rej = await admin.post(`/api/admin/chefs/${rejected.id}/reject`, {
    headers: json,
    data: { reason: "TESTER-REJECT-REASON" },
  });
  expect(rej.status(), await rej.text()).toBe(200);
  await page.goto(`/chefs/${rejected.id}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Chef not found" }),
  ).toBeVisible();
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("TESTER-REJECT-REASON");
  expect(body).not.toContain(rejected.name);
  expect(body.toLowerCase()).not.toContain("rejected");

  // Approved, offers chef's home, kitchen not reviewed yet (Q-21): page opens, no cooking place
  // and no kitchen note.
  const chefCtx = await newContext(playwright, baseURL);
  const name = `E2E NoKitchen ${uniq()}`;
  const chef = await createSubmittedChef(chefCtx, name, { chefHome: true });
  await approve(admin, chefCtx, chef.id);
  const api = await (await page.request.get(`/api/chefs/${chef.id}`)).json();
  await page.goto(`/chefs/${chef.id}`);
  await expect(
    page.getByRole("heading", { level: 1, name, exact: true }),
  ).toBeVisible();
  if (api.locationOptions.length === 0) {
    await expect(page.getByTestId("not-bookable")).toContainText(
      "This chef cannot be booked yet.",
    );
    await expect(page.getByTestId("mock-badge")).toHaveCount(0);
  } else {
    // The chef also offers the customer's home: the chef's home must not be listed.
    await expect(page.getByTestId("location-options")).not.toContainText(
      "chef's home",
    );
  }
  // The address of the kitchen never shows.
  expect(await page.locator("body").innerText()).not.toContain(
    "1 Fictional Street",
  );
  await expectNoAxeViolations(page);

  await rejCtx.dispose();
  await chefCtx.dispose();
  await admin.dispose();
});
