import AxeBuilder from "@axe-core/playwright";
import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

// Runs against the REAL /api routes and a throwaway local Supabase (see playwright.config.ts).
// Dish photos go to the real (local) dish-photos bucket.
const PASSWORD = "e2e-password-1";
const json = { "Content-Type": "application/json" };

const test = base.extend({
  extraHTTPHeaders: async ({}, provide) => {
    await provide({ "x-forwarded-for": randomIp() });
  },
});

function randomIp() {
  const o = () => Math.floor(Math.random() * 254) + 1;
  return `10.${o()}.${o()}.${o()}`;
}
function uniq() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
const PNG = {
  name: "dish.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
};

async function apiSignUp(
  request: APIRequestContext,
  role: "chef" | "customer",
  name: string,
) {
  const r = await request.post("/api/auth/signup", {
    headers: json,
    data: {
      email: `e2e-${role}-${uniq()}@example.com`,
      password: PASSWORD,
      displayName: name,
      role,
    },
  });
  expect(r.status()).toBe(201);
}
async function expectNoAxeViolations(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
}
async function openDishes(page: Page) {
  await page.goto("/chef/dishes");
  await expect(
    page.getByRole("heading", { level: 1, name: "Your dishes" }),
  ).toBeVisible();
  await expect(page.getByText("Loading your dishes")).toHaveCount(0);
}
async function openCalendar(page: Page) {
  await page.goto("/chef/availability");
  await expect(page.getByRole("grid")).toBeVisible();
}
const tabStop = (page: Page) => page.locator("button[data-day][tabindex='0']");

test("the server guard covers every /chef page (no private content is sent)", async ({
  page,
  request,
}) => {
  for (const path of ["/chef/dishes", "/chef/availability", "/chef/apply"]) {
    const body = await (await request.get(path)).text();
    expect(body).toMatch(/http-equiv="refresh"[^>]*url=\/login/);
    expect(body).not.toContain("Add a dish");
    expect(body).not.toContain("Save availability");
    expect(body).not.toContain("Chef pages");
  }
  await page.goto("/chef/dishes");
  await expect(page).toHaveURL(/\/login$/);

  await apiSignUp(page.request, "customer", "Cathy Customer");
  for (const path of ["/chef/dishes", "/chef/availability"]) {
    const body = await (await page.request.get(path)).text();
    expect(body).toMatch(/http-equiv="refresh"[^>]*url=\/"/);
    expect(body).not.toContain("Add a dish");
    expect(body).not.toContain("Save availability");
  }
  await page.goto("/chef/availability");
  await expect(page).toHaveURL(/\/$/);
});

test("a chef adds a dish with a real photo, edits, deactivates and reactivates it", async ({
  page,
}) => {
  await apiSignUp(page.request, "chef", "Mai Tran");
  await openDishes(page);
  await expectNoAxeViolations(page);

  await page.getByRole("button", { name: "Add a dish" }).click();
  await page.getByLabel("Dish name").fill("Pho bo");
  await page.getByLabel("Cuisine", { exact: true }).fill("Vietnamese");
  await page.getByLabel("Description (optional)").fill("Slow broth.\nBeef.");
  await page.getByLabel("Cooking time (minutes)").fill("180");
  await page.getByLabel("Estimated ingredient cost").fill("25.50");
  await page.getByLabel("Servings").fill("4");
  await page.getByLabel("Soy", { exact: true }).check();
  await page.getByLabel("Dish photo").setInputFiles(PNG);
  await page.getByRole("button", { name: "Add dish" }).click();
  await expect(page.getByText("Pho bo was added.")).toBeVisible();

  const card = page.getByRole("article", { name: /Pho bo/ });
  await expect(card).toContainText("$25.50");
  await expect(card).toContainText("Allergens: soy");
  // The photo really loads from the public dish-photos bucket under the chef's own folder.
  const img = card.getByRole("img", { name: "Photo of Pho bo" });
  await expect(img).toHaveAttribute(
    "src",
    /\/storage\/v1\/object\/public\/dish-photos\/[0-9a-f-]{36}\/dish-[0-9a-f-]{36}\.png$/,
  );
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await expectNoAxeViolations(page);

  // Edit keeps the photo; a server-side value survives a reload.
  await page.getByRole("button", { name: "Edit Pho bo" }).click();
  await page.getByLabel("Servings").fill("6");
  await page.getByRole("button", { name: "Save dish" }).click();
  await expect(page.getByText("Pho bo was saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("article", { name: /Pho bo/ })).toContainText(
    "6 servings",
  );
  await expect(
    page.getByRole("img", { name: "Photo of Pho bo" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Deactivate Pho bo" }).click();
  await expect(page.getByText("Pho bo is now inactive.")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("dish-status")).toHaveText("Inactive");
  await page.getByRole("button", { name: "Reactivate Pho bo" }).click();
  await expect(page.getByTestId("dish-status")).toHaveText("Active");
});

test("a missing photo file shows a fallback, and the application sees the dish", async ({
  page,
}) => {
  await apiSignUp(page.request, "chef", "Fallback Chef");
  await openDishes(page);
  await page.getByRole("button", { name: "Add a dish" }).click();
  await page.getByLabel("Dish name").fill("No photo dish");
  await page.getByLabel("Cuisine", { exact: true }).fill("Thai");
  await page.getByLabel("Cooking time (minutes)").fill("30");
  await page.getByRole("button", { name: "Add dish" }).click();
  await expect(page.getByTestId("dish-photo-fallback")).toBeVisible();

  // The application still lists the dish as missing until one has a photo.
  await page.goto("/chef/apply");
  await expect(page.getByTestId("missing-list")).toContainText(
    "At least one active dish with a photo",
  );
  await page.getByRole("link", { name: "Dishes" }).click();
  await page.getByRole("button", { name: "Edit No photo dish" }).click();
  await page.getByLabel("Dish photo").setInputFiles(PNG);
  await page.getByRole("button", { name: "Save dish" }).click();
  await expect(page.getByText("No photo dish was saved.")).toBeVisible();
  await page.goto("/chef/apply");
  await expect(page.getByTestId("missing-list")).not.toContainText(
    "active dish with a photo",
  );
});

test("the 50 active dish cap is shown from the server's 409", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await apiSignUp(page.request, "chef", "Busy Chef");
  for (let i = 0; i < 50; i++) {
    const r = await page.request.post("/api/chef/dishes", {
      headers: json,
      data: { name: `Dish ${i}`, cuisine: "Thai", cookMinutes: 30 },
    });
    expect(r.status()).toBe(201);
  }
  await openDishes(page);
  await expect(page.getByTestId("active-count")).toHaveText(
    "50 of 50 active dishes.",
  );
  await page.getByRole("button", { name: "Add a dish" }).click();
  await page.getByLabel("Dish name").fill("One too many");
  await page.getByLabel("Cuisine", { exact: true }).fill("Thai");
  await page.getByLabel("Cooking time (minutes)").fill("30");
  await page.getByRole("button", { name: "Add dish" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "50 active dishes" });
  await expect(alert).toBeFocused();
  // Deactivate one, then the same form saves.
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Deactivate Dish 0" }).click();
  await expect(page.getByText("Dish 0 is now inactive.")).toBeVisible();
  await page.getByRole("button", { name: "Add a dish" }).click();
  await page.getByLabel("Dish name").fill("One too many");
  await page.getByLabel("Cuisine", { exact: true }).fill("Thai");
  await page.getByLabel("Cooking time (minutes)").fill("30");
  await page.getByRole("button", { name: "Add dish" }).click();
  await expect(page.getByText("One too many was added.")).toBeVisible();
});

test("the availability calendar saves to the server and survives a reload", async ({
  page,
}) => {
  await apiSignUp(page.request, "chef", "Calendar Chef");
  await openCalendar(page);
  await expectNoAxeViolations(page);

  // The window comes from the server.
  const api = await (await page.request.get("/api/chef/availability")).json();
  await expect(tabStop(page)).toHaveAttribute("data-day", api.today);

  await tabStop(page).focus();
  await page.keyboard.press("Space"); // today
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Save availability" }).click();
  await expect(page.getByText("Availability saved.")).toBeVisible();

  const after = await (await page.request.get("/api/chef/availability")).json();
  expect(after.days).toHaveLength(2);
  expect(after.days[0]).toBe(api.today);

  await page.reload();
  await expect(page.getByRole("grid")).toBeVisible();
  await expect(page.locator("button[aria-pressed='true']")).toHaveCount(2);
  await expect(page.getByTestId("availability-summary")).toContainText(
    "2 days ticked. No unsaved changes.",
  );

  // Clear one day.
  await page.locator(`button[data-day="${api.today}"]`).click();
  await page.getByRole("button", { name: "Save availability" }).click();
  await expect(page.getByText("Availability saved.")).toBeVisible();
  const cleared = await (
    await page.request.get("/api/chef/availability")
  ).json();
  expect(cleared.days).toHaveLength(1);
});

test("mobile 375px: dishes and calendar have no horizontal scroll and no axe violations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await apiSignUp(page.request, "chef", "Mobile Chef");
  for (const open of [openDishes, openCalendar]) {
    await open(page);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expectNoAxeViolations(page);
  }
});
