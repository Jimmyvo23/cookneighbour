import AxeBuilder from "@axe-core/playwright";
import {
  test as base,
  expect,
  type APIRequestContext,
  type PlaywrightWorkerArgs,
  type Page,
} from "@playwright/test";
import { createLocalAdmin } from "./helpers/local-admin";
import { createSubmittedChef, uniq } from "./helpers/local-chef";

// T-036: the admin chef-queue UI against the REAL /api routes and a throwaway local Supabase
// (see playwright.config.ts). CLAUDE.md section 12, demo step 5: an admin approves a new chef.
// Every check is a MOCK outcome the admin records by hand; the tests say so by looking for the
// MOCK badges.
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

/** A separate cookie jar, so the chef stays signed in next to the admin's page. */
async function newContext(
  playwright: PlaywrightWorkerArgs["playwright"],
  baseURL: string | undefined,
) {
  return playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { "x-forwarded-for": randomIp() },
  });
}

async function loginAsAdmin(page: Page) {
  const admin = await createLocalAdmin();
  const r = await page.request.post("/api/auth/login", {
    headers: json,
    data: { email: admin.email, password: admin.password },
  });
  expect(r.status()).toBe(200);
  return admin;
}

/** Opens the chef from the queue, loading more pages if the list is long. */
async function openFromQueue(page: Page, name: string) {
  await page.goto("/admin/chefs");
  await expect(
    page.getByRole("heading", { level: 1, name: "Chef applications" }),
  ).toBeVisible();
  const link = page.getByRole("link", { name: `${name} (open application)` });
  for (let i = 0; i < 10 && !(await link.isVisible()); i++) {
    const more = page.getByRole("button", { name: "Load more" });
    if (!(await more.isVisible())) break;
    await more.click();
    await page.waitForTimeout(300);
  }
  await link.click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Review chef application" }),
  ).toBeVisible();
  await expect(page.getByText(name).first()).toBeVisible();
  await expect(page.getByTestId("chef-status")).toBeVisible();
}

async function applicationOf(chef: APIRequestContext) {
  const r = await chef.get("/api/chef/application");
  expect(r.status()).toBe(200);
  return r.json();
}

test("an admin approves a new complete chef: files, MOCK checks, kitchen, approval", async ({
  page,
  playwright,
  baseURL,
}) => {
  const chefCtx = await newContext(playwright, baseURL);
  const name = `E2E Approve ${uniq()}`;
  const chef = await createSubmittedChef(chefCtx, name, { chefHome: true });
  await loginAsAdmin(page);
  await openFromQueue(page, name);

  // The application, the contact email for the review and the files from signed links.
  await expect(page.getByText(chef.email)).toBeVisible();
  const idImg = page.getByRole("img", {
    name: "Government ID uploaded by the chef",
  });
  await expect(idImg).toBeVisible();
  await expect
    .poll(() => idImg.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
  await expect(
    page.getByRole("link", {
      name: "Open Food Handler Certificate in a new tab",
    }),
  ).toHaveAttribute("href", /\/storage\/v1\/object\/sign\//);
  await expect(page.getByRole("img", { name: /Kitchen photo/ })).toHaveCount(2);
  await expect(page.getByTestId("doc-unavailable")).toHaveCount(0);
  await expect(page.getByTestId("mock-badge").first()).toBeVisible();
  await expectNoAxeViolations(page);

  // Too early: the checks are only pending. The server's 409 is shown, focused, nothing changes.
  await page.getByRole("button", { name: "Approve chef" }).click();
  const early = page
    .getByRole("alert")
    .filter({ hasText: "Nothing was saved" });
  await expect(early).toBeFocused();
  await expect(page.getByTestId("chef-status")).toHaveText("Pending");
  expect((await applicationOf(chefCtx)).status).toBe("pending");

  // Record both file checks (MOCK) for the files on screen.
  await page
    .getByLabel("Government ID check result to record")
    .selectOption("verified");
  await page
    .getByLabel("Food Handler Certificate check result to record")
    .selectOption("verified");
  await page.getByRole("button", { name: "Save MOCK checks" }).click();
  await expect(page.getByText(/MOCK checks saved/)).toBeVisible();
  let app = await applicationOf(chefCtx);
  expect(app.checks.id).toBe("verified");
  expect(app.checks.foodHandler).toBe("verified");
  expect(app.checks.police).toBe("not_started");

  // The kitchen review (MOCK) turns on cooking at the chef's home.
  const kitchen = page.getByRole("region", { name: "Kitchen (MOCK review)" });
  await kitchen.getByRole("button", { name: "Approve kitchen (MOCK)" }).click();
  await expect(
    kitchen.getByText(/cooking at the chef's home is on/),
  ).toBeVisible();
  await expect(page.getByTestId("chef-home-state")).toHaveText("on");
  app = await applicationOf(chefCtx);
  expect(app.checks.kitchen).toBe("verified");
  expect(app.chefHomeEnabled).toBe(true);

  // Approve.
  await page.getByRole("button", { name: "Approve chef" }).click();
  await expect(page.getByTestId("chef-status")).toHaveText("Approved");
  await expect(page.getByTestId("decision-state")).toHaveText(
    "This chef is approved.",
  );
  await expect(page.getByTestId("decision-state")).toBeFocused();
  expect((await applicationOf(chefCtx)).status).toBe("approved");
  await expectNoAxeViolations(page);

  // The queue now lists the chef under approved, not under pending.
  await page
    .getByRole("link", { name: "Back to the chef applications" })
    .click();
  await page.getByLabel("Status").selectOption("approved");
  await expect(
    page.getByRole("link", { name: `${name} (open application)` }),
  ).toBeVisible();
  await page.getByLabel("Status").selectOption("pending");
  await expect(
    page.getByText(/Showing \d+ application|No applications match/),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: `${name} (open application)` }),
  ).toHaveCount(0);

  // The approval left a notification row for the chef (the read API comes in WO-5), and the admin
  // API agrees with the screen.
  const detail = await page.request.get(`/api/admin/chefs/${chef.id}`);
  expect((await detail.json()).application.status).toBe("approved");
  await chefCtx.dispose();
});

test("an admin rejects a chef with a reason; the chef sees it and it is plain text", async ({
  page,
  playwright,
  baseURL,
}) => {
  const chefCtx = await newContext(playwright, baseURL);
  const name = `E2E Reject ${uniq()}`;
  const chef = await createSubmittedChef(chefCtx, name);
  await loginAsAdmin(page);
  await openFromQueue(page, name);

  const reason = page.getByLabel("Reason for rejecting (shown to the chef)");
  await page.getByRole("button", { name: "Reject application" }).click();
  await expect(reason).toBeFocused();

  const text = "The ID photo is <b>blurry</b>. Please upload it again.";
  await reason.fill(text);
  await page.getByRole("button", { name: "Reject application" }).click();
  await expect(page.getByTestId("chef-status")).toHaveText("Rejected");
  await expect(page.getByText(text).first()).toBeVisible();
  await expect(page.locator("main b")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve chef" })).toHaveCount(
    0,
  );

  const app = await applicationOf(chefCtx);
  expect(app.status).toBe("rejected");
  expect(app.rejectReason).toBe(text);

  // A second rejection is refused by the server (409); nothing changes.
  const again = await page.request.post(`/api/admin/chefs/${chef.id}/reject`, {
    headers: json,
    data: { reason: "Rejecting twice" },
  });
  expect(again.status()).toBe(409);
  expect((await again.json()).error.code).toBe("INVALID_STATE");
  await chefCtx.dispose();
});

test("a file the chef replaced after the admin opened it: nothing is saved, reload shows the new file", async ({
  page,
  playwright,
  baseURL,
}) => {
  const chefCtx = await newContext(playwright, baseURL);
  const name = `E2E Stale ${uniq()}`;
  const chef = await createSubmittedChef(chefCtx, name);
  await loginAsAdmin(page);
  await openFromQueue(page, name);

  // The chef swaps the ID file while the admin has the page open (real route, real upload).
  const { createClient } = await import("@supabase/supabase-js");
  const svc = createClient(
    process.env.API_URL!,
    process.env.SERVICE_ROLE_KEY ?? process.env.SECRET_KEY!,
  );
  const newId = `${chef.id}/id-${crypto.randomUUID()}.png`;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  const up = await svc.storage
    .from("chef-documents")
    .upload(newId, png, { contentType: "image/png", upsert: false });
  expect(up.error).toBeNull();
  const reg = await chefCtx.post("/api/chef/application/documents", {
    headers: json,
    data: { kind: "id_document", path: newId },
  });
  expect(reg.status()).toBe(200);

  await page
    .getByLabel("Government ID check result to record")
    .selectOption("verified");
  await page
    .getByLabel("Police check result to record")
    .selectOption("verified");
  await page.getByRole("button", { name: "Save MOCK checks" }).click();
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "Nothing was saved" });
  await expect(alert).toBeFocused();
  const app = await applicationOf(chefCtx);
  expect(app.checks.id).toBe("pending"); // the swap reset it; the stale write changed nothing
  expect(app.checks.police).toBe("not_started"); // all or nothing

  await page.getByRole("button", { name: "Reload this application" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "chef changed a file" }),
  ).toBeVisible();
  await page
    .getByLabel("Government ID check result to record")
    .selectOption("verified");
  await page.getByRole("button", { name: "Save MOCK checks" }).click();
  await expect(page.getByText(/MOCK checks saved/)).toBeVisible();
  expect((await applicationOf(chefCtx)).checks.id).toBe("verified");
  await chefCtx.dispose();
});

test("the raw /admin HTML shows nothing to a visitor, a customer or a chef (and does to an admin)", async ({
  page,
  request,
  playwright,
  baseURL,
}) => {
  const paths = [
    "/admin",
    "/admin/chefs",
    "/admin/chefs/00000000-0000-4000-8000-000000000001",
  ];
  const private_ = [
    "Admin pages",
    "Filter applications",
    "Loading applications",
    "Loading application...",
    "Review chef application</h1>",
    "Chef applications</h1>",
  ];
  const expectRedirect = async (ctx: APIRequestContext, target: RegExp) => {
    for (const path of paths) {
      const body = await (await ctx.get(path)).text();
      expect(body, path).toMatch(target);
      for (const s of private_) expect(body, `${path}: ${s}`).not.toContain(s);
    }
  };

  // Visitor.
  await expectRedirect(request, /http-equiv="refresh"[^>]*url=\/login/);

  // Customer.
  const customer = await newContext(playwright, baseURL);
  const c = await customer.post("/api/auth/signup", {
    headers: json,
    data: {
      email: `e2e-customer-${uniq()}@example.com`,
      password: "e2e-password-1",
      displayName: "Cathy Customer",
      role: "customer",
    },
  });
  expect(c.status()).toBe(201);
  await expectRedirect(customer, /http-equiv="refresh"[^>]*url=\/"/);
  await customer.dispose();

  // Chef.
  const chef = await newContext(playwright, baseURL);
  const s = await chef.post("/api/auth/signup", {
    headers: json,
    data: {
      email: `e2e-chef-${uniq()}@example.com`,
      password: "e2e-password-1",
      displayName: "Chef Cook",
      role: "chef",
    },
  });
  expect(s.status()).toBe(201);
  await expectRedirect(chef, /http-equiv="refresh"[^>]*url=\/"/);
  await chef.dispose();

  // The same pages in a browser: a visitor ends on /login.
  await page.goto("/admin/chefs");
  await expect(page).toHaveURL(/\/login$/);

  // Positive control: an admin does get the page shell, so the checks above are not vacuous.
  await loginAsAdmin(page);
  const adminHtml = await (await page.request.get("/admin/chefs")).text();
  expect(adminHtml).toContain("Admin pages");
  expect(adminHtml).not.toMatch(/http-equiv="refresh"/);
});

test("mobile 375px: the queue and a review have no horizontal scroll and no axe violations", async ({
  page,
  playwright,
  baseURL,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const chefCtx = await newContext(playwright, baseURL);
  const name = `E2E Mobile ${uniq()}`;
  await createSubmittedChef(chefCtx, name);
  await loginAsAdmin(page);
  const overflow = () =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
  await page.goto("/admin/chefs");
  await expect(page.getByTestId("queue-count")).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);
  await openFromQueue(page, name);
  await expect(page.getByRole("img", { name: /Government ID/ })).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);
  await chefCtx.dispose();
});
