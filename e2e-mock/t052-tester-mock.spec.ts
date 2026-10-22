import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  SEEDED,
  blockAllStorage,
  loginAdmin,
  loginChef,
  loginCustomer,
  openPage,
  seedCustomerBookings,
  PNG,
} from "./helpers";

// T-052 Tester round, MOCK mode: gaps left by the builder spec. The admin chat page under the same
// strict axe tags (WCAG A/AA + best-practice, nothing disabled) at three views, and focus returning
// to the opener on the two inline panels the builder spec did not cover. Everything is made up.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];
const ADMIN_CHAT_IDS = [
  "00000000-0000-4000-8000-000000008001", // two messages, an open report
  "00000000-0000-4000-8000-000000008004", // 55 messages, "Load more"
  "00000000-0000-4000-8000-000000008006", // a hidden (cancelled) chat
];
const VIEWS = [
  { name: "375 px", width: 375, height: 800, dark: false },
  { name: "desktop", width: 1280, height: 800, dark: false },
  { name: "375 px dark", width: 375, height: 800, dark: true },
];

async function axeClean(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    r.violations.map(
      (v) => `${label} | ${v.id}: ${v.nodes.map((n) => n.target).join(" ; ")}`,
    ),
  ).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await blockAllStorage(page);
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: PNG.buffer }),
  );
});

for (const v of VIEWS) {
  test.describe(`admin chat axe at ${v.name}`, () => {
    test.use({
      viewport: { width: v.width, height: v.height },
      colorScheme: v.dark ? "dark" : "light",
    });
    test("every kind of chat is clean, and the skip link is there", async ({
      page,
    }) => {
      await loginAdmin(page);
      // The mock admin data is built on the first admin call: the list page makes it.
      await openPage(page, "/admin/bookings");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      for (const id of ADMIN_CHAT_IDS) {
        await openPage(page, `/admin/bookings/${id}/chat`);
        await expect(
          page.getByRole("heading", { level: 1, name: "Booking chat" }),
        ).toBeVisible();
        await expect(
          page.getByText(/Admins cannot send messages/),
        ).toBeVisible();
        await axeClean(page, `/admin/bookings/${id}/chat`);
      }
      // 55 messages: Load more brings in older ones, still clean.
      await openPage(page, `/admin/bookings/${ADMIN_CHAT_IDS[1]}/chat`);
      await page.getByRole("button", { name: "Load more" }).click();
      await axeClean(page, "admin chat after Load more");
      await openPage(page, `/admin/bookings/${ADMIN_CHAT_IDS[0]}/chat`);
      await expect(
        page.getByRole("heading", { level: 1, name: "Booking chat" }),
      ).toBeVisible();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("link", { name: "Skip to main content" }),
      ).toBeFocused();
    });
  });
}

test.describe("focus returns to the opener", () => {
  test("report: Close without sending gives focus back to the report button", async ({
    page,
  }) => {
    await loginCustomer(page);
    await seedCustomerBookings(page);
    await openPage(page, `/bookings/${SEEDED.A01}`);
    const open = page.getByTestId("report-button");
    await open.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: /Tell us/ })).toBeFocused();
    await page.getByRole("button", { name: "Close without sending" }).focus();
    await page.keyboard.press("Enter");
    await expect(open).toBeFocused();
  });

  test("receipt dispute: Go back gives focus back to Dispute this receipt", async ({
    page,
  }) => {
    await loginCustomer(page);
    await seedCustomerBookings(page);
    await openPage(page, `/bookings/${SEEDED.A06}`);
    const open = page.getByRole("button", { name: "Dispute this receipt" });
    await open.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByLabel("What is wrong with this receipt?"),
    ).toBeFocused();
    await page.getByRole("button", { name: "Go back" }).focus();
    await page.keyboard.press("Enter");
    await expect(open).toBeFocused();
  });
});

test("the skip link works after in-app navigation from a booking page and the main content is visible", async ({
  page,
}) => {
  await loginCustomer(page);
  await seedCustomerBookings(page);
  await page
    .getByTestId("booking-item")
    .first()
    .getByRole("link")
    .first()
    .click();
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("#main-content")).toHaveCount(1);
  await page.getByRole("link", { name: "Skip to main content" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  await page.keyboard.press("Tab");
  const active = page.locator(":focus");
  await expect(active).toBeVisible(); // the next stop is a visible control, not a hidden page
  const y = await active.evaluate((el) => el.getBoundingClientRect().top);
  expect(y).toBeGreaterThanOrEqual(0);
});

test.describe("focus returns to the opener (chef steps)", () => {
  test("chef: Keep the booking gives focus back to Cancel this booking", async ({
    page,
  }) => {
    await loginChef(page);
    await openPage(page, `/chef/bookings/${SEEDED.A04}`);
    const open = page.getByRole("button", { name: "Cancel this booking" });
    await open.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: "Keep the booking" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Keep the booking" }).focus();
    await page.keyboard.press("Enter");
    await expect(open).toBeFocused();
  });

  test("chef: Keep waiting gives focus back to Mark pickup missed", async ({
    page,
  }) => {
    await loginChef(page);
    await openPage(page, `/chef/bookings/${SEEDED.A05}`);
    const open = page.getByRole("button", { name: "Mark pickup missed" });
    await open.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Keep waiting" }).focus();
    await page.keyboard.press("Enter");
    await expect(open).toBeFocused();
  });
});
