import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

// Runs against the REAL /api routes and a throwaway local Supabase (see playwright.config.ts).
// NEXT_PUBLIC_API_MOCK is blank, so the mock adapter is not used. Phone verification is the
// server's MOCK SMS (any 6 digits); nothing else here is mocked.
const PASSWORD = "e2e-password-1";

const test = base.extend({
  extraHTTPHeaders: async ({}, provide) => {
    await provide({ "x-forwarded-for": randomIp() });
  },
});

function uniq() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
function email(tag: string) {
  return `e2e-${tag}-${uniq()}@example.com`;
}
let phoneCounter = 0;
/** A valid-looking North American number (NXX NXX XXXX) with a wide random range: random area and
 *  exchange codes plus a time-based line number, so old verified numbers in a persistent local
 *  database are very unlikely to collide. */
function phone() {
  // Never an N11 code (211, 911 and so on): phone validation refuses those (T-037).
  const rnd = (lo: number, hi: number): number => {
    const n = lo + Math.floor(Math.random() * (hi - lo + 1));
    return n % 100 === 11 ? rnd(lo, hi) : n;
  };
  const line = (Date.now() + phoneCounter++ * 7919) % 10000;
  return `${rnd(200, 999)}${rnd(200, 999)}${String(line).padStart(4, "0")}`;
}
/** A random client IP per test, so the in-memory sign-up limit (trusts the first X-Forwarded-For
 *  entry) gives each test its own bucket and CI retries cannot run into a 429. Test-only. */
function randomIp() {
  const o = () => Math.floor(Math.random() * 254) + 1;
  return `10.${o()}.${o()}.${o()}`;
}
const json = { "Content-Type": "application/json" };

async function apiSignUp(
  request: APIRequestContext,
  addr: string,
  name = "Api Person",
) {
  const r = await request.post("/api/auth/signup", {
    headers: json,
    data: {
      email: addr,
      password: PASSWORD,
      displayName: name,
      role: "customer",
    },
  });
  expect(r.status()).toBe(201);
}
async function apiVerifyPhone(request: APIRequestContext, number: string) {
  const a = await request.post("/api/me/phone", {
    headers: json,
    data: { phone: number },
  });
  expect(a.status()).toBe(200);
  const b = await request.post("/api/me/phone/verify", {
    headers: json,
    data: { code: "123456" },
  });
  expect(b.status()).toBe(200);
}
async function apiLogout(request: APIRequestContext) {
  const r = await request.post("/api/auth/logout", { headers: json });
  expect(r.status()).toBe(200);
}
async function uiLogin(page: Page, addr: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(addr);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}
const formAlert = (page: Page) => page.getByRole("main").getByRole("alert");

test("real routes: no MOCK API badge", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("MOCK API — no real data")).toHaveCount(0);
});

test("sign-up, MOCK phone verify, address, log out, log in", async ({
  page,
}) => {
  const addr = email("flow");
  const number = phone();
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Mai Tran");
  await page.getByLabel("Email").fill(addr);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("radio", { name: /customer/ }).check();
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page).toHaveURL(/\/verify-phone$/);
  await expect(
    page.getByTestId("mock-badge").filter({ hasText: "no real SMS" }),
  ).toBeVisible();
  await page.getByLabel("Mobile phone number").fill(number);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByRole("status")).toContainText("MOCK");
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();

  await expect(page).toHaveURL(/\/address$/);
  await page.getByLabel("Street address").fill("1 Main St");
  await page.getByLabel("City").fill("Mississauga");
  // 422 from the real route: V6B is not a GTA prefix.
  await page.getByLabel("Postal code").fill("V6B 1A1");
  await page.getByRole("button", { name: "Save address" }).click();
  await expect(page.getByText("Not a GTA postal code.")).toBeVisible();
  await page.getByLabel("Postal code").fill("L5B 1M2");
  await page.getByRole("button", { name: "Save address" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Signed in as Mai Tran")).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
  await expect(page.getByText(/Signed in as/)).toHaveCount(0);

  // Fully onboarded user lands on the home page after logging in.
  await uiLogin(page, addr);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Signed in as Mai Tran")).toBeVisible();
});

test("route guards and onboarding redirects", async ({ page }) => {
  await page.goto("/verify-phone");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/address");
  await expect(page).toHaveURL(/\/login$/);

  const addr = email("guard");
  await apiSignUp(page.request, addr, "Guard Person");
  await apiLogout(page.request);

  // Unverified phone: log-in goes to /verify-phone, and /address bounces back there.
  await uiLogin(page, addr);
  await expect(page).toHaveURL(/\/verify-phone$/);
  await page.goto("/address");
  await expect(page).toHaveURL(/\/verify-phone$/);

  // Signed in: /login and /signup go home.
  await page.goto("/login");
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/signup");
  await expect(page).toHaveURL(/\/$/);

  // Verified phone but no address: log-in goes to /address.
  await apiVerifyPhone(page.request, phone());
  await apiLogout(page.request);
  await uiLogin(page, addr);
  await expect(page).toHaveURL(/\/address$/);
});

test("duplicate email shows 409 message", async ({ page }) => {
  const addr = email("dup");
  await apiSignUp(page.request, addr);
  await apiLogout(page.request);
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Second Try");
  await page.getByLabel("Email").fill(addr);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(formAlert(page)).toContainText(
    "An account with this email already exists.",
  );
  await expect(page).toHaveURL(/\/signup$/);
});

test("wrong password shows 401 message", async ({ page }) => {
  const addr = email("wrongpw");
  await apiSignUp(page.request, addr);
  await apiLogout(page.request);
  await uiLogin(page, addr, "not-the-password");
  await expect(formAlert(page)).toContainText(
    "Email or password is incorrect.",
  );
  await expect(formAlert(page)).toBeFocused();
  await expect(page).toHaveURL(/\/login$/);
});

test("a phone number verified by another account is refused (409)", async ({
  page,
}) => {
  const number = phone();
  await apiSignUp(page.request, email("owner"), "Owner");
  await apiVerifyPhone(page.request, number);
  await apiLogout(page.request);

  const addr = email("squatter");
  await apiSignUp(page.request, addr, "Second Account");
  await apiLogout(page.request);
  await uiLogin(page, addr);
  await expect(page).toHaveURL(/\/verify-phone$/);
  await page.getByLabel("Mobile phone number").fill(number);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(formAlert(page)).toContainText(
    "This phone number cannot be used.",
  );
});
