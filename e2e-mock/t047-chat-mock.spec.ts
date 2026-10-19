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

// T-047, MOCK mode, 375 px: the booking chat on both booking pages. The mock chat adapter
// (src/lib/mocks/mock-messages.ts) keeps messages in this tab only; there is no Realtime here
// (the page says so). All data is made up.
test.use({ viewport: { width: 375, height: 800 } });

let storageTried: string[];
test.beforeEach(async ({ page }) => {
  storageTried = await blockAllStorage(page);
});
test.afterEach(() => {
  expect(storageTried).toEqual([]);
});

const chat = (page: Page) => page.getByTestId("chat").filter({ visible: true });
const box = (page: Page) => chat(page).getByRole("textbox");
const send = (page: Page) => chat(page).getByRole("button", { name: "Send" });

async function customerOn(page: Page, id: string, hooks = {}) {
  await loginCustomer(page);
  // Hooks such as frozenSeeded are read when the made-up bookings are brought in: set them first.
  await setMockHooks(page, { seedCustomer: true, ...hooks });
  await openPage(page, `/bookings/${id}`);
  await expect(page.getByTestId("loading")).toHaveCount(0);
}

async function chefOn(page: Page, id: string, hooks = {}) {
  await loginChef(page);
  await setMockHooks(page, hooks);
  await openPage(page, `/chef/bookings/${id}`);
  await expect(page.getByTestId("loading")).toHaveCount(0);
}

async function setStatus(
  page: Page,
  key: "bookings" | "chefBookings",
  id: string,
  status: string,
) {
  await editMockState(
    page,
    (st, a: { key: string; id: string; status: string }) => {
      for (const r of st[a.key])
        if (r.detail.id === a.id) r.detail.status = a.status;
    },
    { key, id, status },
  );
}

test("customer: an accepted booking has a labelled MOCK chat that sends and keeps focus in the box", async ({
  page,
}) => {
  await customerOn(page, SEEDED.A04);
  await expect(chat(page).getByRole("heading", { level: 2 })).toContainText(
    "Chat with",
  );
  await expect(page.getByTestId("chat-mock")).toContainText("MOCK");
  await expect(page.getByTestId("chat-mock")).toContainText("no live updates");
  await expect(
    chat(page).getByRole("region", { name: /Messages with/ }),
  ).toBeVisible();
  await expect(chat(page).getByTestId("chat-message")).toHaveCount(1); // the MOCK greeting
  await box(page).fill("See you tomorrow morning");
  await expect(page.getByTestId("chat-count")).toContainText("24 of 2000");
  await send(page).click();
  await expect(chat(page).getByTestId("chat-message")).toHaveCount(2);
  await expect(chat(page).getByTestId("chat-message").last()).toContainText(
    "See you tomorrow morning",
  );
  await expect(chat(page).getByTestId("chat-message").last()).toHaveAttribute(
    "data-state",
    "sent",
  );
  await expect(box(page)).toBeFocused();
  await expect(box(page)).toHaveValue("");
  // Your own send is not announced in the live region.
  await expect(page.getByTestId("chat-live")).toHaveText("");
  expect(await scrollsSideways(page)).toBe(false);
  await expectNoAxeViolations(page);
});

test("customer: before the chef accepts, contact details are refused with the server text and focus", async ({
  page,
}) => {
  await customerOn(page, SEEDED.A01);
  await box(page).fill("Call me on 416 555 0123");
  await send(page).click();
  const err = page.getByTestId("chat-error").filter({ visible: true });
  await expect(err).toContainText("Do not put phone numbers");
  await expect(err).toBeFocused();
  await expect(box(page)).toHaveValue("Call me on 416 555 0123");
  await expect(chat(page).getByTestId("chat-message")).toHaveCount(1);
  expect(await scrollsSideways(page)).toBe(false);
  await expectNoAxeViolations(page);
  // Plain text goes through.
  await box(page).fill("Is Thursday possible?");
  await send(page).click();
  await expect(chat(page).getByTestId("chat-message")).toHaveCount(2);
});

test("customer: the rate limit message names the wait and keeps the text", async ({
  page,
}) => {
  await customerOn(page, SEEDED.A04, { messagesRateLimited: true });
  await box(page).fill("Hello");
  await send(page).click();
  const err = page.getByTestId("chat-error").filter({ visible: true });
  await expect(err).toContainText("too quickly");
  await expect(err).toContainText("30 seconds");
  await expect(err).toBeFocused();
  await expect(box(page)).toHaveValue("Hello");
  await expectNoAxeViolations(page);
  await send(page).click(); // the limit was one-off
  await expect(chat(page).getByTestId("chat-message")).toHaveCount(2);
});

test("customer: more than 2000 characters shows the counter and is not sent", async ({
  page,
}) => {
  await customerOn(page, SEEDED.A04);
  await box(page).fill("a".repeat(2001));
  await expect(page.getByTestId("chat-count")).toContainText("1 too many");
  await send(page).click();
  await expect(
    page.getByTestId("chat-error").filter({ visible: true }),
  ).toContainText("limit is 2000");
  await expect(chat(page).getByTestId("chat-message")).toHaveCount(1);
  await expectNoAxeViolations(page);
});

test("customer: a message that could not be sent shows Not sent, takes focus, and Retry sends it once", async ({
  page,
}) => {
  await customerOn(page, SEEDED.A04, { messagesFailNext: true });
  await box(page).fill("Are you free on Friday?");
  await send(page).click();
  const failed = chat(page).getByTestId("chat-failed");
  await expect(failed).toContainText("Not sent");
  await expect(failed).toBeFocused();
  await expect(box(page)).toHaveValue("");
  expect(await scrollsSideways(page)).toBe(false);
  await expectNoAxeViolations(page);
  await chat(page).getByRole("button", { name: "Retry sending" }).click();
  await expect(chat(page).getByTestId("chat-failed")).toHaveCount(0);
  await expect(chat(page).getByTestId("chat-message")).toHaveCount(2);
  await expect(chat(page).getByTestId("chat-message").last()).toHaveAttribute(
    "data-state",
    "sent",
  );
  await expect(box(page)).toBeFocused();
});

test("customer: a frozen booking shows the chat read only with a neutral note", async ({
  page,
}) => {
  await customerOn(page, SEEDED.A04, { frozenSeeded: [SEEDED.A04] });
  await expect(chat(page).getByTestId("chat-message")).toHaveCount(1);
  await expect(page.getByTestId("chat-frozen")).toContainText("read only");
  await expect(page.getByTestId("chat-frozen")).not.toContainText(
    /flag|report/i,
  );
  await expect(chat(page).getByRole("textbox")).toHaveCount(0);
  await expect(chat(page).getByRole("button", { name: "Send" })).toHaveCount(0);
  expect(await scrollsSideways(page)).toBe(false);
  await expectNoAxeViolations(page);
});

test("customer: a completed booking keeps the chat open", async ({ page }) => {
  await customerOn(page, SEEDED.A04);
  await setStatus(page, "bookings", SEEDED.A04, "completed");
  await openPage(page, `/bookings/${SEEDED.A04}`);
  await expect(page.getByTestId("status")).toContainText("Completed");
  await expect(box(page)).toBeVisible();
  await expect(page.getByTestId("contact-window")).toContainText(
    "Chat stays open.",
  );
  await expectNoAxeViolations(page);
});

for (const status of ["declined", "cancelled", "expired", "no_show_chef"]) {
  test(`customer: a ${status} booking shows no chat at all`, async ({
    page,
  }) => {
    await customerOn(page, SEEDED.A04);
    await setStatus(page, "bookings", SEEDED.A04, status);
    await openPage(page, `/bookings/${SEEDED.A04}`);
    await expect(page.getByTestId("loading")).toHaveCount(0);
    await expect(page.getByTestId("status")).toBeVisible();
    await expect(page.getByTestId("chat")).toHaveCount(0);
    await expect(page.getByText(/Chat with/)).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
}

test("chef: an accepted booking has the chat and sends", async ({ page }) => {
  await chefOn(page, SEEDED.A04);
  await expect(chat(page).getByRole("heading", { level: 2 })).toContainText(
    "Chat with",
  );
  await expect(page.getByTestId("chat-mock")).toContainText("MOCK");
  await box(page).fill("I will bring my own knives");
  await send(page).click();
  await expect(chat(page).getByTestId("chat-message")).toHaveCount(2);
  await expect(box(page)).toBeFocused();
  expect(await scrollsSideways(page)).toBe(false);
  await expectNoAxeViolations(page);
});

test("chef: a request refuses contact details; a declined one has no chat", async ({
  page,
}) => {
  await chefOn(page, SEEDED.A01);
  await box(page).fill("Email me at lan@example.com");
  await send(page).click();
  await expect(
    page.getByTestId("chat-error").filter({ visible: true }),
  ).toContainText("Do not put phone numbers");
  await expectNoAxeViolations(page);

  await setStatus(page, "chefBookings", SEEDED.A01, "declined");
  await openPage(page, `/chef/bookings/${SEEDED.A01}`);
  await expect(page.getByTestId("loading")).toHaveCount(0);
  await expect(page.getByTestId("chat")).toHaveCount(0);
  await expectNoAxeViolations(page);
});

test("chef: a frozen booking shows the chat read only", async ({ page }) => {
  await chefOn(page, SEEDED.A04, { frozenSeeded: [SEEDED.A04] });
  await expect(page.getByTestId("chat-frozen")).toContainText("read only");
  await expect(chat(page).getByRole("textbox")).toHaveCount(0);
  expect(await scrollsSideways(page)).toBe(false);
  await expectNoAxeViolations(page);
});
