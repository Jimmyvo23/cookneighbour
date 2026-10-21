import {
  test as base,
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { createLocalAdmin } from "./helpers/local-admin";
import { createSubmittedChef, uniq } from "./helpers/local-chef";

// T-050: the CLAUDE.md section 12 demo path, end to end, against the REAL /api routes, a throwaway
// local Supabase (with Realtime) and real cookie sessions. Nothing here is mocked except what the
// product itself mocks: the phone code (any 6 digits), the admin's ID and food-handler checks, and
// the payment step (nothing is charged).
//
// Demo step 1: search Mississauga for a Vietnamese chef and find one.
// Demo step 2: pick dishes, see time and cost, book 2 days with the free first booking.
// Demo step 3: the chef accepts; both sides exchange messages LIVE (two browser contexts).
// Demo step 4: the customer leaves a review -> test.fixme below, waits for T-049.
// Demo step 5: an admin approves a new chef; a second free-trial attempt is blocked.
//
// DATA STRATEGY (lessons-learned section 3): the spec creates its own chefs and customers per run.
// Each chef gets a unique language word so the search singles it out (no shared "Vietnamese"
// rows), the booking dates are +20 and +21 days (no other e2e file uses them, and the chef is
// ours anyway), each customer gets a random street number and a random verified phone, and nothing
// asserts an exact list. Chat text carries no digits (a digit run can trip the phone rule).
const json = { "Content-Type": "application/json" };
const o = () => Math.floor(Math.random() * 254) + 1;
const randomIp = () => `10.${o()}.${o()}.${o()}`;
const PASSWORD = "e2e-password-1";
const test = base.extend({
  extraHTTPHeaders: async ({}, provide) => {
    await provide({ "x-forwarded-for": randomIp() });
  },
});

/** A fresh browser context (own cookie jar) with its own fake client IP, for rate limits. */
function newBrowserContext(browser: Browser, baseURL: string | undefined) {
  return browser.newContext({
    baseURL,
    extraHTTPHeaders: { "x-forwarded-for": randomIp() },
  });
}

/** Digits turned into letters, so random text cannot look like a phone number. */
function words(s: string) {
  return s.replace(/[0-9]/g, (d) => "abcdefghij"[Number(d)]);
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

/** Signs up and signs in a customer on `request`'s cookie jar; phone (MOCK code) and address set. */
async function signUpCustomer(
  request: APIRequestContext,
  name: string,
  opts: { line: string; postalCode?: string; phoneNumber?: string },
) {
  const email = `e2e-demo-cust-${uniq()}@example.com`;
  const s = await request.post("/api/auth/signup", {
    headers: json,
    data: { email, password: PASSWORD, displayName: name, role: "customer" },
  });
  expect(s.status(), await s.text()).toBe(201);
  const phoneNumber = opts.phoneNumber ?? phone();
  const p = await request.post("/api/me/phone", {
    headers: json,
    data: { phone: phoneNumber },
  });
  expect(p.status(), await p.text()).toBe(200);
  const v = await request.post("/api/me/phone/verify", {
    headers: json,
    data: { code: "123456" }, // MOCK: any code works
  });
  expect(v.status(), await v.text()).toBe(200);
  const a = await request.put("/api/me/address", {
    headers: json,
    data: {
      line: opts.line,
      city: "Mississauga",
      postalCode: opts.postalCode ?? "L5B 1M2",
    },
  });
  expect(a.status(), await a.text()).toBe(200);
  return { email, phoneNumber };
}

/** Signs a new customer up WITHOUT a phone, for the same-phone attempt. */
async function signUpBare(request: APIRequestContext, name: string) {
  const s = await request.post("/api/auth/signup", {
    headers: json,
    data: {
      email: `e2e-demo-cust-${uniq()}@example.com`,
      password: PASSWORD,
      displayName: name,
      role: "customer",
    },
  });
  expect(s.status(), await s.text()).toBe(201);
}

/** The chef's own unique words, so the search can single them out. */
async function tag(chef: APIRequestContext, word: string) {
  const r = await chef.patch("/api/chef/application", {
    headers: json,
    data: {
      cuisines: ["Vietnamese", word],
      languages: ["English", "Vietnamese", word],
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}

async function loginAs(
  request: APIRequestContext,
  email: string,
  password: string,
) {
  const r = await request.post("/api/auth/login", {
    headers: json,
    data: { email, password },
  });
  expect(r.status(), await r.text()).toBe(200);
}

/** Records the chef's two ID/food-handler checks (MOCK) and approves, through the API. */
async function approveByApi(
  admin: APIRequestContext,
  chefCtx: APIRequestContext,
  id: string,
) {
  const app = await (await chefCtx.get("/api/chef/application")).json();
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
  const approve = await admin.post(`/api/admin/chefs/${id}/approve`, {
    headers: json,
    data: {},
  });
  expect(approve.status(), await approve.text()).toBe(200);
}

async function adminContext(browser: Browser, baseURL: string | undefined) {
  const account = await createLocalAdmin();
  const ctx = await newBrowserContext(browser, baseURL);
  await loginAs(ctx.request, account.email, account.password);
  return ctx;
}

/**
 * Resolves when the page's Realtime channel for this booking's chat has been ACKNOWLEDGED by the
 * server (the phx_reply with the postgres_changes subscription). Messages sent after this can
 * only reach the page through Realtime. The frame check is deliberately loose about the wire
 * format (JSON object or array) and strict about the four facts that matter.
 */
function watchRealtimeJoin(page: Page, bookingId: string) {
  const state = { joined: false };
  page.on("websocket", (ws) => {
    ws.on("framereceived", (frame) => {
      const text =
        typeof frame.payload === "string"
          ? frame.payload
          : frame.payload.toString("utf8");
      if (
        text.includes(`chat:${bookingId}`) &&
        text.includes("phx_reply") &&
        text.includes("postgres_changes") &&
        /"status"\s*:\s*"ok"/.test(text)
      )
        state.joined = true;
    });
  });
  return state;
}

async function sendChat(page: Page, text: string) {
  await page.getByTestId("chat-box").fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  // Our own bubble is saved (no "Sending..." state left).
  await expect(
    page
      .getByTestId("chat-message")
      .filter({ hasText: text })
      .and(page.locator('[data-state="sent"]')),
  ).toHaveCount(1);
}

/** Fills the booking form for `dates` (two days of Pho) and opens the review. */
async function fillAndReview(page: Page, dates: string[]) {
  await page.getByLabel("How many days?").selectOption(String(dates.length));
  for (let i = 0; i < dates.length; i++) {
    await page.getByLabel(`Date for day ${i + 1}`).selectOption(dates[i]);
    await page.getByRole("checkbox", { name: `Pho on day ${i + 1}` }).check();
  }
  await page.getByRole("radio", { name: "At your home" }).check();
  await page.getByRole("radio", { name: "I buy the ingredients" }).check();
  await page.getByRole("checkbox", { name: "I have no allergies" }).check();
  await page.getByRole("checkbox", { name: "I have no dietary needs" }).check();
  await page.getByRole("button", { name: "Review my request" }).click();
  await expect(page.getByTestId("review-heading")).toBeVisible();
}

/** Opens an admin-queue application from the list, loading more pages until it is there. */
async function openFromQueue(page: Page, name: string) {
  await page.goto("/admin/chefs");
  await expect(
    page.getByRole("heading", { level: 1, name: "Chef applications" }),
  ).toBeVisible();
  const link = page.getByRole("link", { name: `${name} (open application)` });
  const all = page.getByRole("link", { name: /\(open application\)/ });
  const more = page.getByRole("button", { name: "Load more" });
  for (let i = 0; i < 30; i++) {
    await expect(link.or(more).first()).toBeVisible();
    if (await link.isVisible()) break;
    const before = await all.count();
    await more.click();
    // Wait for the next page to arrive (more rows, or no more pages), no fixed sleep.
    await expect
      .poll(
        async () => (await all.count()) > before || !(await more.isVisible()),
      )
      .toBe(true);
  }
  await link.click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Review chef application" }),
  ).toBeVisible();
}

async function publicChefNames(page: Page, word: string): Promise<string[]> {
  const r = await page.request.get(
    `/api/chefs?cuisine=Vietnamese&language=${encodeURIComponent(word)}&limit=50`,
  );
  expect(r.status()).toBe(200);
  const body = await r.json();
  return body.items.map((x: { displayName: string }) => x.displayName);
}

test.describe("CLAUDE.md section 12 demo path (real stack)", () => {
  test("demo steps 1, 2, 3 and 5: search, book 2 days free, chef accepts, live chat, admin approves, second free trial blocked", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    const chefName = `E2E Demo Chef ${uniq()}`;
    const word = `Demo${uniq()}`;
    const street = `${100 + Math.floor(Math.random() * 8900)} Demo${uniq().slice(0, 6)} Street`;

    // ---- Setup: a Vietnamese chef in Mississauga, approved by an admin (via API here; the admin
    // UI approval is the subject of step 5 with a second chef). Two bookable days.
    const chefBrowser = await newBrowserContext(browser, baseURL);
    const chef = await createSubmittedChef(chefBrowser.request, chefName);
    await tag(chefBrowser.request, word);
    const adminApi = await adminContext(browser, baseURL);
    await approveByApi(adminApi.request, chefBrowser.request, chef.id);
    const win = await (
      await chefBrowser.request.get("/api/chef/availability")
    ).json();
    const plus = (n: number) => {
      const d = new Date(`${win.today}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const dates = [plus(20), plus(21)];
    const put = await chefBrowser.request.put("/api/chef/availability", {
      headers: json,
      data: { add: dates },
    });
    expect(put.status(), await put.text()).toBe(200);

    const customerBrowser = await newBrowserContext(browser, baseURL);
    const customer = await signUpCustomer(
      customerBrowser.request,
      "E2E Demo Customer",
      { line: street },
    );
    const page = await customerBrowser.newPage();

    // ---- Step 1: search Mississauga for a Vietnamese chef and find one.
    await test.step("1. the customer searches Mississauga for a Vietnamese chef", async () => {
      await page.goto("/search");
      await expect(
        page.getByRole("heading", { level: 1, name: "Find a home cook" }),
      ).toBeVisible();
      await expect(page.getByLabel("Or a city")).toBeEnabled();
      await page.getByLabel("Or a city").selectOption("Mississauga");
      await page.getByLabel("Cuisine").fill("Vietnamese");
      await page.getByLabel("Language the chef speaks (optional)").fill(word);
      await page.getByRole("button", { name: "Find chefs" }).click();
      await expect(page.getByTestId("results-status")).toContainText("Showing");
      const link = page.getByRole("link", { name: chefName, exact: true });
      await expect(link).toBeVisible();
      const card = page.getByTestId("chef-result").filter({ has: link });
      await expect(card).toContainText("Cuisines: Vietnamese");
      await expect(card).toContainText("$30/hour");
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/chefs/${chef.id}$`));
      await expect(
        page.getByRole("heading", { level: 1, name: chefName }),
      ).toBeVisible();
    });

    // ---- Step 2: dishes, estimate, 2 days on the free first booking.
    let bookingId = "";
    await test.step("2. the customer picks dishes, sees time and cost, and books 2 days on the free trial", async () => {
      await page.getByTestId("book-link").click();
      await expect(page).toHaveURL(new RegExp(`/chefs/${chef.id}/book$`));
      await fillAndReview(page, dates);
      const estimate = page.getByTestId("estimate");
      // 2 days x Pho (120 minutes) = 4 hours of cooking.
      await expect(estimate).toContainText(/Total cooking time.*4 h/);
      await expect(page.getByTestId("trial-applied")).toBeVisible();
      await expect(estimate).toContainText("Labour you pay$0.00");
      await expect(page.getByTestId("platform-fee")).toContainText(
        "Shown only, not collected",
      );
      await expect(page.getByTestId("mock-payment")).toContainText(
        "does not charge you",
      );
      await page.getByRole("button", { name: "Send booking request" }).click();
      await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}\?sent=1$/);
      bookingId = page.url().match(/bookings\/([0-9a-f-]{36})/)![1];
      await expect(page.getByTestId("status")).toContainText(
        "Waiting for the chef to answer",
      );
      await expect(page.getByTestId("trial-label")).toBeVisible();
      // 6.8: no phone number and no chef address before the chef accepts.
      await expect(page.getByTestId("contact-later")).toBeVisible();
      const detail = await (
        await customerBrowser.request.get(`/api/bookings/${bookingId}`)
      ).json();
      expect(detail.isFreeTrial).toBe(true);
      expect(detail.contact).toBeNull();
    });

    // ---- Step 3a: the chef sees the request and accepts it.
    const chefPage = await chefBrowser.newPage();
    await test.step("3a. the chef opens the request and accepts it", async () => {
      await loginAs(chefBrowser.request, chef.email, chef.password);
      await chefPage.goto("/chef/bookings");
      await expect(chefPage.getByTestId("group-answer")).toBeVisible();
      await chefPage.goto(`/chef/bookings/${bookingId}`);
      await expect(chefPage.getByTestId("status")).toContainText(
        "Waiting for your answer",
      );
      // The chef reads the intake form before answering; the phone is still hidden.
      await expect(chefPage.getByTestId("intake")).toBeVisible();
      await expect(chefPage.getByTestId("contact")).toHaveCount(0);
      await chefPage
        .getByRole("button", { name: "Accept this request" })
        .click();
      await expect(chefPage.getByTestId("status")).toContainText(
        "You accepted this booking",
      );
      // Accepted: the chef now sees the customer's phone number (6.8).
      await expect(chefPage.getByTestId("contact")).toContainText(
        customer.phoneNumber.slice(-4),
      );
    });

    // ---- Step 3b: both sides chat, live, in two browser contexts.
    await test.step("3b. customer and chef exchange messages live through Realtime, no reload", async () => {
      // Fresh page loads on both sides, then wait until BOTH pages' Realtime channels are
      // acknowledged by the server. After that a message can only arrive through Realtime.
      const customerJoin = watchRealtimeJoin(page, bookingId);
      const chefJoin = watchRealtimeJoin(chefPage, bookingId);
      await page.goto(`/bookings/${bookingId}`);
      await chefPage.goto(`/chef/bookings/${bookingId}`);
      await expect(page.getByTestId("status")).toContainText(/accepted/i);
      await expect(page.getByTestId("contact")).toBeVisible();
      await expect(page.getByTestId("chat-box")).toBeVisible();
      await expect(chefPage.getByTestId("chat-box")).toBeVisible();
      await expect
        .poll(() => customerJoin.joined && chefJoin.joined, {
          message:
            "both pages' Realtime channels should be acknowledged (phx_reply ok)",
          timeout: 30_000,
        })
        .toBe(true);
      // Proof of "no reload": a marker on the window survives to the end.
      await page.evaluate(
        () => ((window as unknown as Record<string, number>).__e2eNoReload = 1),
      );
      await chefPage.evaluate(
        () => ((window as unknown as Record<string, number>).__e2eNoReload = 1),
      );

      const toChef = `Hello chef ${words(uniq())}, are you happy to cook pho for me`;
      await sendChat(page, toChef);
      await expect(
        chefPage.getByTestId("chat-message").filter({ hasText: toChef }),
      ).toHaveCount(1, { timeout: 20_000 });
      await expect(chefPage.getByTestId("chat-live")).toContainText(
        "New message from",
      );

      const toCustomer = `Yes happily ${words(uniq())}, I will bring the herbs`;
      await sendChat(chefPage, toCustomer);
      await expect(
        page.getByTestId("chat-message").filter({ hasText: toCustomer }),
      ).toHaveCount(1, { timeout: 20_000 });

      // Neither page reloaded, and the history is in order on both sides.
      expect(
        await page.evaluate(
          () => (window as unknown as Record<string, number>).__e2eNoReload,
        ),
      ).toBe(1);
      expect(
        await chefPage.evaluate(
          () => (window as unknown as Record<string, number>).__e2eNoReload,
        ),
      ).toBe(1);
      await expect(page.getByTestId("chat-message")).toHaveText([
        new RegExp(toChef),
        new RegExp(toCustomer),
      ]);
      await expect(chefPage.getByTestId("chat-message")).toHaveText([
        new RegExp(toChef),
        new RegExp(toCustomer),
      ]);
    });

    // ---- Step 5a: an admin approves a NEW chef in the admin UI.
    await test.step("5a. an admin approves a new chef (MOCK checks) and the chef appears in search", async () => {
      const newName = `E2E Demo New Chef ${uniq()}`;
      const newWord = `New${uniq()}`;
      const newChefBrowser = await newBrowserContext(browser, baseURL);
      const newChef = await createSubmittedChef(
        newChefBrowser.request,
        newName,
      );
      await tag(newChefBrowser.request, newWord);
      // Pending: not in the public search.
      expect(await publicChefNames(page, newWord)).not.toContain(newName);

      const adminBrowser = await adminContext(browser, baseURL);
      const adminPage = await adminBrowser.newPage();
      await openFromQueue(adminPage, newName);
      await adminPage
        .getByLabel("Government ID check result to record")
        .selectOption("verified");
      await adminPage
        .getByLabel("Food Handler Certificate check result to record")
        .selectOption("verified");
      await adminPage.getByRole("button", { name: "Save MOCK checks" }).click();
      await expect(adminPage.getByText(/MOCK checks saved/)).toBeVisible();
      await adminPage.getByRole("button", { name: "Approve chef" }).click();
      await expect(adminPage.getByTestId("chef-status")).toHaveText("Approved");

      await expect
        .poll(() => publicChefNames(page, newWord))
        .toContain(newName);
      const app = await (
        await newChefBrowser.request.get("/api/chef/application")
      ).json();
      expect(app.status).toBe("approved");
      expect(newChef.id).toBeTruthy();
      await adminBrowser.close();
      await newChefBrowser.close();
    });

    // ---- Step 5b: a second free-trial attempt is blocked.
    await test.step("5b. a second free trial is blocked: same phone, and same address on a new account", async () => {
      // (i) New account, SAME verified phone: the number belongs to one account only.
      const samePhone = await newBrowserContext(browser, baseURL);
      await signUpBare(samePhone.request, "E2E Same Phone");
      const dup = await samePhone.request.post("/api/me/phone", {
        headers: json,
        data: { phone: customer.phoneNumber },
      });
      expect(dup.status(), await dup.text()).toBe(409);
      expect((await dup.json()).error.code).toBe("PHONE_IN_USE");
      await samePhone.close();

      // (ii) New account, new phone, SAME home address written a different way
      // (upper case, "STREET" spelled differently, postal code without the space).
      const otherBrowser = await newBrowserContext(browser, baseURL);
      const other = await signUpCustomer(
        otherBrowser.request,
        "E2E Second Trial",
        {
          line: street.toUpperCase().replace("STREET", "St."),
          postalCode: "l5b1m2",
        },
      );
      expect(other.phoneNumber).not.toBe(customer.phoneNumber);
      const otherPage = await otherBrowser.newPage();
      // The first booking holds days 20 and 21, so the chef opens one more day for this attempt.
      const extra = plus(22);
      const add = await chefBrowser.request.put("/api/chef/availability", {
        headers: json,
        data: { add: [extra] },
      });
      expect(add.status(), await add.text()).toBe(200);
      await otherPage.goto(`/chefs/${chef.id}/book`);
      await expect(
        otherPage.getByRole("heading", { level: 1, name: `Book ${chefName}` }),
      ).toBeVisible();
      await otherPage.getByLabel("How many days?").selectOption("1");
      await otherPage.getByLabel("Date for day 1").selectOption(extra);
      await otherPage.getByRole("checkbox", { name: "Pho on day 1" }).check();
      await otherPage.getByRole("radio", { name: "At your home" }).check();
      await otherPage
        .getByRole("radio", { name: "I buy the ingredients" })
        .check();
      await otherPage
        .getByRole("checkbox", { name: "I have no allergies" })
        .check();
      await otherPage
        .getByRole("checkbox", { name: "I have no dietary needs" })
        .check();
      await otherPage
        .getByRole("button", { name: "Review my request" })
        .click();
      await expect(otherPage.getByTestId("review-heading")).toBeVisible();
      // The estimate does not give the free first booking: labour is charged.
      await expect(otherPage.getByTestId("trial-blocked")).toBeVisible();
      await expect(otherPage.getByTestId("trial-applied")).toHaveCount(0);

      // Asking for the free trial directly is refused by the server and leaves no booking.
      const dishes = await (
        await otherBrowser.request.get(`/api/chefs/${chef.id}`)
      ).json();
      const dishId = dishes.dishes[0].id as string;
      const attempt = await otherBrowser.request.post("/api/bookings", {
        headers: json,
        data: {
          chefId: chef.id,
          locationType: "customer_home",
          address: {
            line: street,
            city: "Mississauga",
            postalCode: "L5B 1M2",
          },
          days: [{ date: extra, dishes: [{ dishId }] }],
          groceryOption: "customer_buys",
          intake: {
            noAllergies: true,
            noDietaryNeeds: true,
          },
          useFreeTrial: true,
        },
      });
      expect(attempt.status(), await attempt.text()).toBe(409);
      expect((await attempt.json()).error.code).toBe("FREE_TRIAL_USED");
      const list = await (
        await otherBrowser.request.get("/api/bookings")
      ).json();
      expect(list.items).toHaveLength(0);

      // The admin's block log has the attempt, with the real reason (address).
      const adminBrowser = await adminContext(browser, baseURL);
      const me = await (await otherBrowser.request.get("/api/me")).json();
      let found: { reason: string } | undefined;
      let cursor: string | null = null;
      for (let i = 0; i < 30 && !found; i++) {
        const r = await adminBrowser.request.get(
          `/api/admin/free-trial-blocks?limit=50${cursor ? `&cursor=${cursor}` : ""}`,
        );
        expect(r.status()).toBe(200);
        const body: {
          items: { customer: { id: string }; reason: string }[];
          nextCursor: string | null;
        } = await r.json();
        found = body.items.find((x) => x.customer.id === me.profile.id);
        cursor = body.nextCursor;
        if (!cursor) break;
      }
      expect(found?.reason).toBe("address");
      await adminBrowser.close();
      await otherBrowser.close();
    });

    await closeAll([chefBrowser, customerBrowser, adminApi]);
  });

  // TODO(T-050, step 4): add after T-049 (PR #181, reviews UI) is merged. Needs: the chef marks
  // the visit done (POST /api/bookings/:id/complete after each day is cooked), then the customer
  // opens the booking, leaves a review, and it shows on the chef's public page. The Planner will
  // send the Tester back after T-049 merges.
  test.fixme("demo step 4: after the visit the customer leaves a review (waits for T-049)", async () => {});
});

async function closeAll(ctxs: BrowserContext[]) {
  for (const c of ctxs) await c.close();
}
