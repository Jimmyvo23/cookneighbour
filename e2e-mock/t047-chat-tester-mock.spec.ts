import { expect, test, type Page } from "@playwright/test";
import {
  SEEDED,
  blockAllStorage,
  editMockState,
  expectNoAxeViolations,
  loginChef,
  loginCustomer,
  openPage,
  scrollsSideways,
  setMockHooks,
} from "./helpers";

// T-047 Tester, MOCK mode, 375 px. Extra checks beside t047-chat-mock.spec.ts: hidden chats make no
// request and write nothing, no live connection or Supabase request is made, Remove, focus owners.
test.use({ viewport: { width: 375, height: 800 } });

let storageTried: string[];
let leaks: string[];
let messageRequests: string[];
test.beforeEach(async ({ page }) => {
  storageTried = await blockAllStorage(page);
  leaks = [];
  messageRequests = [];
  page.on("request", (r) => {
    const u = r.url();
    if (/supabase|\/realtime\/|\/rest\/v1\//.test(u)) leaks.push(u);
    if (/\/messages(\?|$)/.test(u)) messageRequests.push(u);
  });
  page.on("websocket", (w) => {
    if (!w.url().includes("/_next/")) leaks.push(`websocket ${w.url()}`); // the dev server's own HMR socket is fine
  });
});
test.afterEach(() => {
  expect(storageTried).toEqual([]);
  expect(leaks).toEqual([]); // MOCK mode never loads the Supabase client or opens a socket
});

const chat = (page: Page) => page.getByTestId("chat").filter({ visible: true });
const box = (page: Page) => chat(page).getByRole("textbox");
const send = (page: Page) => chat(page).getByRole("button", { name: "Send" });

type Key = "bookings" | "chefBookings";
async function setDetail(
  page: Page,
  key: Key,
  id: string,
  patch: Record<string, unknown>,
) {
  await editMockState(
    page,
    (st, a: { key: string; id: string; patch: Record<string, unknown> }) => {
      for (const r of st[a.key])
        if (r.detail.id === a.id) Object.assign(r.detail, a.patch);
    },
    { key, id, patch },
  );
}
/** The MOCK chat of a booking as saved in this tab (undefined when nothing was ever written). */
async function savedChat(page: Page, id: string) {
  return page.evaluate((i) => {
    const st = JSON.parse(
      sessionStorage.getItem("cookneighbour-mock-api-state") ?? "{}",
    );
    return st.messages?.[i] ?? null;
  }, id);
}

async function customerList(page: Page) {
  await loginCustomer(page);
  await setMockHooks(page, { seedCustomer: true });
  await openPage(page, "/bookings");
  await expect(page.getByTestId("booking-item").first()).toBeVisible();
}
async function chefList(page: Page) {
  await loginChef(page);
  await openPage(page, "/chef/bookings");
  await expect(page.getByTestId("booking-item").first()).toBeVisible();
}

const HIDDEN = [
  "declined",
  "cancelled",
  "expired",
  "no_show_customer",
  "no_show_chef",
];

for (const status of HIDDEN) {
  test(`customer: ${status} makes no /messages request and writes no chat`, async ({
    page,
  }) => {
    await customerList(page);
    await setDetail(page, "bookings", SEEDED.A04, { status });
    messageRequests.length = 0;
    await openPage(page, `/bookings/${SEEDED.A04}`);
    await expect(page.getByTestId("loading")).toHaveCount(0);
    await expect(page.getByTestId("status")).toBeVisible();
    await expect(page.getByTestId("chat")).toHaveCount(0);
    await expect(page.getByTestId("chat-mock")).toHaveCount(0);
    expect(messageRequests).toEqual([]);
    expect(await savedChat(page, SEEDED.A04)).toBeNull(); // no greeting written either
    expect(await scrollsSideways(page)).toBe(false);
    await expectNoAxeViolations(page);
  });

  test(`chef: ${status} makes no /messages request and writes no chat`, async ({
    page,
  }) => {
    await chefList(page);
    await setDetail(page, "chefBookings", SEEDED.A04, { status });
    await openPage(page, `/chef/bookings/${SEEDED.A04}`);
    await expect(page.getByTestId("loading")).toHaveCount(0);
    await expect(page.getByTestId("status")).toBeVisible();
    await expect(page.getByTestId("chat")).toHaveCount(0);
    expect(messageRequests).toEqual([]);
    expect(await savedChat(page, SEEDED.A04)).toBeNull();
    await expectNoAxeViolations(page);
  });
}

test("customer: a request past expiresAt shows no chat and writes none", async ({
  page,
}) => {
  await customerList(page);
  await setDetail(page, "bookings", SEEDED.A01, {
    status: "requested",
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  });
  await openPage(page, `/bookings/${SEEDED.A01}`);
  await expect(page.getByTestId("loading")).toHaveCount(0);
  await expect(page.getByTestId("status")).toBeVisible();
  await expect(page.getByTestId("chat")).toHaveCount(0);
  expect(await savedChat(page, SEEDED.A01)).toBeNull();
  await expectNoAxeViolations(page);
});

test("chef: a request past expiresAt shows no chat and writes none", async ({
  page,
}) => {
  await chefList(page);
  await setDetail(page, "chefBookings", SEEDED.A01, {
    status: "requested",
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  });
  await openPage(page, `/chef/bookings/${SEEDED.A01}`);
  await expect(page.getByTestId("loading")).toHaveCount(0);
  await expect(page.getByTestId("status")).toBeVisible();
  await expect(page.getByTestId("chat")).toHaveCount(0);
  expect(await savedChat(page, SEEDED.A01)).toBeNull();
});

test("customer: a request before expiresAt has the chat", async ({ page }) => {
  await customerList(page);
  await openPage(page, `/bookings/${SEEDED.A01}`);
  await expect(chat(page)).toBeVisible();
  await expect(box(page)).toBeVisible();
});

test("the history greeting from the other party is not announced; the live region is polite", async ({
  page,
}) => {
  await customerList(page);
  await openPage(page, `/bookings/${SEEDED.A04}`);
  await expect(chat(page).getByTestId("chat-message")).toHaveCount(1);
  await expect(page.getByTestId("chat-live")).toHaveText("");
  await expect(page.getByTestId("chat-live")).toHaveAttribute(
    "aria-live",
    "polite",
  );
});

test("Remove: a failed message is dropped, nothing is sent again, and focus returns to the box", async ({
  page,
}) => {
  await customerList(page);
  await setMockHooks(page, { messagesFailNext: true });
  await openPage(page, `/bookings/${SEEDED.A04}`);
  await expect(chat(page).getByTestId("chat-message")).toHaveCount(1);
  await box(page).fill("Please drop this one");
  await send(page).click();
  const failed = chat(page).getByTestId("chat-failed");
  await expect(failed).toBeFocused();
  await expectNoAxeViolations(page);
  await chat(page).getByRole("button", { name: "Remove message" }).click();
  await expect(chat(page).getByTestId("chat-failed")).toHaveCount(0);
  await expect(chat(page).getByTestId("chat-message")).toHaveCount(1);
  await expect(box(page)).toBeFocused();
  const saved = (await savedChat(page, SEEDED.A04)) as { body: string }[];
  expect(saved.map((m) => m.body).join("|")).not.toContain("drop this");
});

test("focus has one owner: a refusal then a later failure then a retry end in the box", async ({
  page,
}) => {
  await customerList(page);
  await setMockHooks(page, { messagesRateLimited: true });
  await openPage(page, `/bookings/${SEEDED.A04}`);
  await expect(chat(page).getByTestId("chat-message")).toHaveCount(1);
  await box(page).fill("one");
  await send(page).click();
  await expect(
    page.getByTestId("chat-error").filter({ visible: true }),
  ).toBeFocused();
  await setMockHooks(page, { messagesFailNext: true });
  await send(page).click();
  await expect(chat(page).getByTestId("chat-failed")).toBeFocused();
  await expect(
    page.getByTestId("chat-error").filter({ visible: true }),
  ).toHaveText("");
  await chat(page).getByRole("button", { name: "Retry sending" }).click();
  await expect(box(page)).toBeFocused();
  await expect(chat(page).getByTestId("chat-message")).toHaveCount(2);
  await expectNoAxeViolations(page);
});

test("the booking page and the chat survive a long message and a long unbroken word at 375 px", async ({
  page,
}) => {
  await customerList(page);
  await openPage(page, `/bookings/${SEEDED.A04}`);
  await expect(chat(page).getByTestId("chat-message")).toHaveCount(1);
  await box(page).fill(`${"x".repeat(180)}\n\n${"word ".repeat(120)}`);
  await send(page).click();
  await expect(chat(page).getByTestId("chat-message")).toHaveCount(2);
  expect(await scrollsSideways(page)).toBe(false);
  await expectNoAxeViolations(page);
});
