import AxeBuilder from "@axe-core/playwright";
import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
  type PlaywrightWorkerArgs,
} from "@playwright/test";
import { createLocalAdmin } from "./helpers/local-admin";
import { createSubmittedChef, uniq } from "./helpers/local-chef";

// T-043: the booking flow against the REAL /api routes and a throwaway local Supabase (see
// playwright.config.ts). CLAUDE.md section 12, demo step 2: the customer picks dishes, sees the
// estimate and books 2 days with the free first booking. The chef is created through the real
// routes and approved by a real (local) admin; every check the admin records is a MOCK outcome and
// the payment step is MOCK (nothing is charged). The server guards of the private pages are
// checked here, because the mock adapter has no server session.
const json = { "Content-Type": "application/json" };
const o = () => Math.floor(Math.random() * 254) + 1;
const randomIp = () => `10.${o()}.${o()}.${o()}`;
const PASSWORD = "e2e-password-1";
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

async function approvedChefWithDays(
  playwright: PlaywrightWorkerArgs["playwright"],
  baseURL: string | undefined,
  name: string,
  offsets: number[],
) {
  const chefCtx = await newContext(playwright, baseURL);
  const chef = await createSubmittedChef(chefCtx, name);
  const adminAccount = await createLocalAdmin();
  const admin = await newContext(playwright, baseURL);
  const login = await admin.post("/api/auth/login", {
    headers: json,
    data: { email: adminAccount.email, password: adminAccount.password },
  });
  expect(login.status()).toBe(200);
  const app = await (await chefCtx.get("/api/chef/application")).json();
  const checks = await admin.patch(`/api/admin/chefs/${chef.id}/checks`, {
    headers: json,
    data: {
      idCheck: "verified",
      idDocumentPath: app.documents.idDocumentPath,
      foodHandlerCheck: "verified",
      foodHandlerPath: app.documents.foodHandlerPath,
    },
  });
  expect(checks.status(), await checks.text()).toBe(200);
  const approve = await admin.post(`/api/admin/chefs/${chef.id}/approve`, {
    headers: json,
    data: {},
  });
  expect(approve.status(), await approve.text()).toBe(200);
  await admin.dispose();

  const win = await (await chefCtx.get("/api/chef/availability")).json();
  const plus = (n: number) => {
    const d = new Date(`${win.today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const dates = offsets.map(plus);
  const put = await chefCtx.put("/api/chef/availability", {
    headers: json,
    data: { add: dates },
  });
  expect(put.status(), await put.text()).toBe(200);
  return { chef, chefCtx, dates, plus };
}

let phoneCounter = 0;
function phone() {
  const rnd = (lo: number, hi: number): number => {
    const n = lo + Math.floor(Math.random() * (hi - lo + 1));
    return n % 100 === 11 ? rnd(lo, hi) : n;
  };
  const line = (Date.now() + phoneCounter++ * 7919) % 10000;
  return `${rnd(200, 999)}${rnd(200, 999)}${String(line).padStart(4, "0")}`;
}

/**
 * A signed-in customer with a verified (MOCK) phone and a home address, on `request`'s cookie jar.
 * The street number is random: the free first booking is tied to the address, so customers of
 * earlier runs or retries must not share it.
 */
async function signedInCustomer(request: APIRequestContext, name: string) {
  const line = `${100 + Math.floor(Math.random() * 8900)} Test${uniq().slice(0, 6)} St`;
  const email = `e2e-cust-${uniq()}@example.com`;
  const s = await request.post("/api/auth/signup", {
    headers: json,
    data: { email, password: PASSWORD, displayName: name, role: "customer" },
  });
  expect(s.status(), await s.text()).toBe(201);
  const p = await request.post("/api/me/phone", {
    headers: json,
    data: { phone: phone() },
  });
  expect(p.status(), await p.text()).toBe(200);
  const v = await request.post("/api/me/phone/verify", {
    headers: json,
    data: { code: "123456" },
  });
  expect(v.status(), await v.text()).toBe(200);
  const a = await request.put("/api/me/address", {
    headers: json,
    data: { line, city: "Mississauga", postalCode: "L5B 1M2" },
  });
  expect(a.status(), await a.text()).toBe(200);
  return { email, line };
}

async function fillAndReview(
  page: Page,
  dates: string[],
  opts: { chefHome?: boolean } = {},
) {
  await page.getByLabel("How many days?").selectOption(String(dates.length));
  for (let i = 0; i < dates.length; i++) {
    await page.getByLabel(`Date for day ${i + 1}`).selectOption(dates[i]);
    await page.getByRole("checkbox", { name: `Pho on day ${i + 1}` }).check();
  }
  await page
    .getByRole("radio", {
      name: opts.chefHome ? "At the chef's home" : "At your home",
    })
    .check();
  await page.getByRole("radio", { name: "I buy the ingredients" }).check();
  await page.getByRole("checkbox", { name: "I have no allergies" }).check();
  await page.getByRole("checkbox", { name: "I have no dietary needs" }).check();
  await page.getByRole("button", { name: "Review my request" }).click();
  await expect(page.getByTestId("review-heading")).toBeVisible();
}

test("demo step 2: a customer books 2 days with the free first booking; addresses stay private; a second booking is full price", async ({
  page,
  playwright,
  baseURL,
}) => {
  const name = `E2E Book ${uniq()}`;
  const { chef, chefCtx, dates } = await approvedChefWithDays(
    playwright,
    baseURL,
    name,
    [5, 6, 8],
  );
  const me = await signedInCustomer(page.request, "E2E Customer");

  // From the chef page to the booking page.
  await page.goto(`/chefs/${chef.id}`);
  await page.getByTestId("book-link").click();
  await expect(page).toHaveURL(new RegExp(`/chefs/${chef.id}/book$`));
  await expect(
    page.getByRole("heading", { level: 1, name: `Book ${name}` }),
  ).toBeVisible();
  // The home address from the account starts the cooking address.
  await page.getByRole("radio", { name: "At your home" }).check();
  await expect(page.getByLabel("Street address")).toHaveValue(me.line);
  await expect(page.getByLabel("City")).toHaveValue("Mississauga");
  await expectNoAxeViolations(page);

  await fillAndReview(page, [dates[0], dates[1]]);
  await expect(page.getByTestId("estimate")).toContainText(
    /Total cooking time.*4 h/,
  );
  await expect(page.getByTestId("trial-applied")).toBeVisible();
  await expect(page.getByTestId("estimate")).toContainText(
    "Labour you pay$0.00",
  );
  await expect(page.getByTestId("mock-payment")).toContainText(
    "does not charge you",
  );
  await expect(page.getByTestId("platform-fee")).toContainText(
    "Shown only, not collected",
  );
  await expect(page.getByTestId("expiry-note")).toContainText(
    "The chef has until",
  );
  await expectNoAxeViolations(page);

  await page.getByRole("button", { name: "Send booking request" }).click();
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}\?sent=1$/);
  const id = page.url().match(/bookings\/([0-9a-f-]{36})/)![1];
  await expect(page.getByTestId("sent-banner")).toContainText(
    "Nothing was charged",
  );
  await expect(page.getByTestId("status")).toContainText(
    "Waiting for the chef to answer",
  );
  await expect(page.getByTestId("trial-label")).toBeVisible();
  await expect(page.getByTestId("contact-later")).toBeVisible();
  await expectNoAxeViolations(page);

  // 6.8: before acceptance the API sends no phone number and no chef address.
  const detail = await (await page.request.get(`/api/bookings/${id}`)).json();
  expect(detail.status).toBe("requested");
  expect(detail.isFreeTrial).toBe(true);
  expect(detail.contact).toBeNull();
  expect(detail.cookingPlace).toMatchObject({ line: me.line });
  expect(detail.payment).toEqual({ mock: true, collected: false });
  const body = await page.locator("main").filter({ visible: true }).innerText();
  expect(body).not.toMatch(/\+?1?\s?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);

  // The booking is in the customer's list; another customer cannot open it.
  await page.goto("/bookings");
  await expect(page.getByTestId("booking-item")).toHaveCount(1);
  await expect(page.getByTestId("open-count")).toContainText("Waiting now: 1");
  const other = await newContext(playwright, baseURL);
  await signedInCustomer(other, "Another Customer");
  expect((await other.get(`/api/bookings/${id}`)).status()).toBe(404);
  await other.dispose();

  // The booked days are no longer offered on the form (A-19).
  await page.goto(`/chefs/${chef.id}/book`);
  await expect(
    page.getByLabel("Date for day 1").locator(`option[value="${dates[0]}"]`),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Date for day 1").locator(`option[value="${dates[2]}"]`),
  ).toHaveCount(1);

  // A second booking: the free first booking is gone, labour is charged in the estimate.
  await fillAndReview(page, [dates[2]]);
  await expect(page.getByTestId("trial-blocked")).toBeVisible();
  await expect(page.getByTestId("trial-applied")).toHaveCount(0);
  await page.getByRole("button", { name: "Send booking request" }).click();
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}\?sent=1$/);
  await expect(page.getByTestId("trial-label")).toHaveCount(0);

  // Cancelling shows the timing before the customer confirms (day 3+ away: on time).
  await page.getByRole("button", { name: "Cancel this booking" }).click();
  await expect(page.getByTestId("free-cancel-note")).toBeVisible();
  await page.getByRole("button", { name: "Yes, cancel this booking" }).click();
  await expect(page.getByTestId("status")).toContainText("Cancelled");
  await expect(page.getByTestId("cancel-timing")).toContainText("on-time");

  await chefCtx.dispose();
});

test("server guards: a visitor goes to log in, a chef goes home, and a chef who cannot be booked is a not-found page", async ({
  page,
  browser,
  playwright,
  baseURL,
}) => {
  const { chef, chefCtx } = await approvedChefWithDays(
    playwright,
    baseURL,
    `E2E Guard ${uniq()}`,
    [5],
  );

  // A visitor: the server redirects before any form is sent.
  await page.goto(`/chefs/${chef.id}/book`);
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/bookings");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto(`/bookings/00000000-0000-4000-8000-00000000abcd`);
  await expect(page).toHaveURL(/\/login$/);

  // A chef.
  const chefBrowser = await browser.newContext({
    baseURL,
    extraHTTPHeaders: { "x-forwarded-for": randomIp() },
  });
  const login = await chefBrowser.request.post("/api/auth/login", {
    headers: json,
    data: { email: chef.email, password: chef.password },
  });
  expect(login.status()).toBe(200);
  const chefPage = await chefBrowser.newPage();
  await chefPage.goto(`/chefs/${chef.id}/book`);
  await expect(chefPage).toHaveURL(/\/$/);
  await chefPage.goto("/bookings");
  await expect(chefPage).toHaveURL(/\/$/);
  await chefBrowser.close();

  // A customer asks for a chef who is still pending: the same page as an unknown chef.
  await signedInCustomer(page.request, "Guard Customer");
  const pending = await createSubmittedChef(
    await newContext(playwright, baseURL),
    `E2E Pending ${uniq()}`,
  );
  await page.goto(`/chefs/${pending.id}/book`);
  await expect(page.getByTestId("not-found")).toContainText(
    "This chef cannot be booked",
  );
  const first = await page.getByTestId("not-found").innerText();
  await page.goto(`/chefs/00000000-0000-4000-8000-00000000abcd/book`);
  await expect(page.getByTestId("not-found")).toBeVisible();
  expect(await page.getByTestId("not-found").innerText()).toBe(first);
  await expectNoAxeViolations(page);

  await chefCtx.dispose();
});
