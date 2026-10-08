import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

// Runs against the REAL /api routes and a throwaway local Supabase (see playwright.config.ts).
// Files go to real (local) Storage buckets. The ID, food-handler and kitchen checks are MOCK
// (an admin would set them; the UI says so). Chefs have no dish editor yet (T-034), so the test
// inserts one sample dish with the local service role, exactly as tests/api/chef-helpers.ts does.
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
let phoneCounter = 0;
function phone() {
  const rnd = (lo: number, hi: number) =>
    lo + Math.floor(Math.random() * (hi - lo + 1));
  const line = (Date.now() + phoneCounter++ * 7919) % 10000;
  return `${rnd(200, 999)}${rnd(200, 999)}${String(line).padStart(4, "0")}`;
}

const PNG = {
  name: "scan.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
};
const PDF = {
  name: "cert.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
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
async function apiVerifyPhone(request: APIRequestContext) {
  const a = await request.post("/api/me/phone", {
    headers: json,
    data: { phone: phone() },
  });
  expect(a.status()).toBe(200);
  const b = await request.post("/api/me/phone/verify", {
    headers: json,
    data: { code: "123456" },
  });
  expect(b.status()).toBe(200);
}
async function myId(request: APIRequestContext): Promise<string> {
  const r = await request.get("/api/me");
  return (await r.json()).profile.id;
}
async function openApplication(page: Page) {
  await page.goto("/chef/apply");
  await expect(
    page.getByRole("heading", { level: 1, name: "Chef application" }),
  ).toBeVisible();
  await expect(page.getByLabel("Display name")).toBeVisible();
}
async function expectNoAxeViolations(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
}

test("the server guard keeps visitors and customers out (no private page content is sent)", async ({
  page,
  request,
}) => {
  const signedOut = await request.get("/chef/apply");
  const body = await signedOut.text();
  expect(body).toMatch(/http-equiv="refresh"[^>]*url=\/login/);
  expect(body).not.toContain("Display name");

  await page.goto("/chef/apply");
  await expect(page).toHaveURL(/\/login$/);

  await apiSignUp(page.request, "customer", "Cathy Customer");
  const asCustomer = await (await page.request.get("/chef/apply")).text();
  expect(asCustomer).toMatch(/http-equiv="refresh"[^>]*url=\/"/);
  expect(asCustomer).not.toContain("Display name");
  await page.goto("/chef/apply");
  await expect(page).toHaveURL(/\/$/);
});

test("a chef completes the application against the real routes and submits", async ({
  page,
}) => {
  await apiSignUp(page.request, "chef", "Mai Tran");
  await apiVerifyPhone(page.request);
  const chefId = await myId(page.request);
  await openApplication(page);
  await expect(page.getByText("MOCK API — no real data")).toHaveCount(0);
  await expectNoAxeViolations(page);

  const status = page.getByRole("region", { name: /Status/ });
  await expect(status.getByTestId("mock-badge")).toHaveCount(3);
  await expect(status).toContainText("Draft, not submitted yet");

  // Early submit: the contract's 409 list is shown and takes focus.
  await page.getByRole("button", { name: "Submit application" }).click();
  const early = page.getByRole("alert").filter({ hasText: "not complete" });
  await expect(early).toBeFocused();
  await expect(early).toContainText("A short bio");

  // Server-side 422 (V6B is a valid shape but not a GTA postal code area): shown on the field.
  await page.getByLabel("Bio").fill("I cook Vietnamese home food.");
  await page.getByLabel("Cuisines").fill("Vietnamese");
  await page.getByLabel("Languages you speak").fill("English, Vietnamese");
  await page.getByLabel("Hourly rate").fill("28");
  await page.getByLabel("Postal code area you serve").fill("V6B");
  await page.getByLabel("Service radius (km)").fill("15");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByLabel("Postal code area you serve")).toBeFocused();
  await expect(page.getByText("Not a GTA postal code area.")).toBeVisible();
  await page.getByLabel("Postal code area you serve").fill("L5B");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();

  // Real uploads to Storage, then registration.
  await page.getByLabel("Choose a profile photo").setInputFiles(PNG);
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(page.getByText("A profile photo is saved.")).toBeVisible();
  await page.getByLabel("Choose your government ID file").setInputFiles(PNG);
  await page.getByRole("button", { name: "Upload ID" }).click();
  await expect(page.getByRole("button", { name: "Replace ID" })).toBeVisible();
  await page
    .getByLabel("Choose your Food Handler Certificate file")
    .setInputFiles(PDF);
  await page.getByRole("button", { name: "Upload certificate" }).click();
  await expect(
    page.getByRole("button", { name: "Replace certificate" }),
  ).toBeVisible();

  // A second ID upload gets a new file name (no overwrite) and still works.
  await page.getByLabel("Choose your government ID file").setInputFiles(PNG);
  await page.getByRole("button", { name: "Replace ID" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Uploaded and saved." }).first(),
  ).toBeVisible();

  await page
    .getByLabel("I acknowledge the allergen-awareness statement")
    .check();
  await page.getByRole("button", { name: "Save acknowledgement" }).click();
  await expect(page.getByText(/Acknowledged on/)).toBeVisible();

  // Chef's home: kitchen address, photo (upload then remove then add), hygiene acknowledgement.
  await page.getByLabel(/At my home/).check();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(
    page.getByRole("heading", { name: /Your kitchen/ }),
  ).toBeVisible();
  await expect(status.getByTestId("mock-badge")).toHaveCount(4);
  await page.getByLabel("Kitchen street address").fill("5 Oak Ave");
  await page.getByLabel("Kitchen city").fill("Mississauga");
  await page.getByLabel("Kitchen postal code").fill("L5B 1A1");
  await page.getByRole("button", { name: "Save kitchen address" }).click();
  await expect(page.getByText("Kitchen address saved.")).toBeVisible();
  await page.getByLabel("Choose a kitchen photo").setInputFiles(PNG);
  await page.getByRole("button", { name: "Add kitchen photo" }).click();
  await expect(
    page.getByText("Kitchen photo 1", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove kitchen photo 1" }).click();
  await expect(page.getByText("Kitchen photo 1 removed.")).toBeVisible();
  await page.getByLabel("Choose a kitchen photo").setInputFiles(PNG);
  await page.getByRole("button", { name: "Add kitchen photo" }).click();
  await expect(
    page.getByText("Kitchen photo 1", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("I acknowledge the kitchen-hygiene statement").check();
  await page.getByRole("button", { name: "Save acknowledgement" }).click();
  await expect(page.getByText(/Acknowledged on/)).toHaveCount(2);

  // Still missing: the sample dish (no dish editor until T-034).
  await expect(page.getByTestId("missing-list")).toContainText("dish");
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "not complete" }),
  ).toBeFocused();

  // Test fixture only: give the chef one active dish with a photo using the local service role.
  const svc = createClient(
    process.env.API_URL!,
    process.env.SERVICE_ROLE_KEY ?? process.env.SECRET_KEY!,
  );
  const dish = await svc.from("dishes").insert({
    chef_id: chefId,
    name: "Pho",
    cuisine: "Vietnamese",
    cook_minutes: 120,
    photo_path: `${chefId}/dish-${crypto.randomUUID()}.png`,
  });
  expect(dish.error).toBeNull();

  await page.reload();
  await expect(page.getByLabel("Display name")).toBeVisible();
  await expect(page.getByText("Everything needed is in place.")).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(page.getByText(/Submitted\. MOCK/)).toBeVisible();
  await expect(status).toContainText("Submitted, waiting for review");
  await expect(status.getByText("Pending review")).toHaveCount(3);

  // The submitted state survives a reload (it comes from the database, not the page).
  await page.reload();
  await expect(page.getByRole("region", { name: /Status/ })).toContainText(
    "Submitted, waiting for review",
  );
});

test("keyboard only: a chef can reach and save the profile form", async ({
  page,
}) => {
  await apiSignUp(page.request, "chef", "Keyboard Chef");
  await openApplication(page);
  await page.getByLabel("Bio").focus();
  await page.keyboard.type("Home cook.");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Thai");
  await page.keyboard.press("Tab");
  await page.keyboard.type("English");
  await page.keyboard.press("Tab");
  await page.keyboard.type("30");
  await page.keyboard.press("Tab");
  await page.keyboard.type("l5b");
  await page.keyboard.press("Tab");
  await page.keyboard.type("12");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Profile saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Bio")).toHaveValue("Home cook.");
  await expect(page.getByLabel("Postal code area you serve")).toHaveValue(
    "L5B",
  );
});

test("mobile 375px: no horizontal scroll and no axe violations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await apiSignUp(page.request, "chef", "Mobile Chef");
  await openApplication(page);
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);
});
