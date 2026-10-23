import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  SEEDED,
  blockAllStorage,
  dayPlus,
  loginAdmin,
  loginChef,
  loginCustomer,
  openChef,
  openPage,
  seedCustomerBookings,
  signUpChef,
  signUpCustomer,
  PNG,
} from "./helpers";

// T-052, MOCK mode: an axe pass (WCAG 2.0/2.1 A and AA tags, nothing disabled) over every page, at
// 375 px and at desktop width, in the signed-in role each page needs. Everything is made up.
const MAI = "00000000-0000-4000-8000-000000001001";
const VIEWPORTS = [
  { name: "375 px", width: 375, height: 800 },
  { name: "desktop", width: 1280, height: 800 },
  { name: "375 px, dark mode", width: 375, height: 800, dark: true },
];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

async function axeClean(page: Page, label: string) {
  // T-116: Next streams the page <title> (route metadata) after the body, and on a client-side
  // move to a new page the head is updated a moment after the h1 shows. A slow machine (or the dev
  // server under load) reaches axe in between and sees no title (`document-title`). Wait for the
  // title to exist; the `document-title` rule itself still runs.
  await expect(page).toHaveTitle(/\S/);
  // The same for the Suspense fallback of the guarded pages (/bookings and others): a bare
  // "Loading..." line outside any landmark (a `region` finding) shows until the page guard
  // resolves, and a stale h1 from the page before can satisfy the test's own h1 wait.
  await expect(
    page.getByText("Loading...", { exact: true }).filter({ visible: true }),
  ).toHaveCount(0);
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

for (const vp of VIEWPORTS) {
  test.describe(`axe at ${vp.name}`, () => {
    test.use({
      viewport: { width: vp.width, height: vp.height },
      colorScheme: vp.dark ? "dark" : "light",
    });

    test("signed out: home, search, chef page, login, signup", async ({
      page,
    }) => {
      for (const path of ["/", "/login", "/signup"]) {
        await openPage(page, path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await axeClean(page, path);
      }
      await openPage(page, "/search");
      await expect(page.getByLabel("Or a city")).toBeEnabled();
      await page.getByLabel("Or a city").selectOption("Mississauga");
      await page.getByLabel("Cuisine").fill("Vietnamese");
      await page.getByRole("button", { name: "Find chefs" }).click();
      await expect(page.getByTestId("chef-result").first()).toBeVisible();
      await axeClean(page, "/search results");
      await openPage(page, `/chefs/${MAI}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await axeClean(page, "/chefs/[id]");
    });

    test("signed-out error states: login and signup with errors", async ({
      page,
    }) => {
      await openPage(page, "/login");
      await page.getByRole("button", { name: "Log in" }).click();
      await axeClean(page, "/login errors");
      await openPage(page, "/signup");
      await page.getByRole("button", { name: "Sign up" }).click();
      await axeClean(page, "/signup errors");
    });

    test("customer: verify-phone, address, allergies, book, bookings", async ({
      page,
    }) => {
      await signUpCustomer(page, { verified: false });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await axeClean(page, "/verify-phone");
      await page.getByLabel("Mobile phone number").fill("416 555 0123");
      await page.getByRole("button", { name: "Send code" }).click();
      await page.getByLabel("6-digit code").fill("123456");
      await axeClean(page, "/verify-phone code step");
      await page.getByRole("button", { name: "Verify" }).click();
      await expect(page).toHaveURL(/\/address$/);
      await expect(page.getByLabel("Street address")).toBeVisible();
      await axeClean(page, "/address");
      await page.getByLabel("Street address").fill("1 Main St");
      await page.getByLabel("City").fill("Mississauga");
      await page.getByLabel("Postal code").fill("L5B 1M2");
      await page.getByRole("button", { name: "Save address" }).click();
      await expect(page).toHaveURL(/\/$/);
      await openPage(page, "/allergies");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await axeClean(page, "/allergies");
      await openPage(page, `/chefs/${MAI}/book`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await axeClean(page, "/chefs/[id]/book");
      await openPage(page, "/bookings");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await axeClean(page, "/bookings empty");
    });

    test("customer: bookings list and booking pages", async ({ page }) => {
      await loginCustomer(page);
      await seedCustomerBookings(page);
      await axeClean(page, "/bookings");
      for (const id of [SEEDED.A01, SEEDED.A03, SEEDED.A06]) {
        await openPage(page, `/bookings/${id}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await axeClean(page, `/bookings/${id}`);
      }
    });

    test("chef: apply, availability, dishes, bookings", async ({ page }) => {
      await signUpChef(page, "Test Chef");
      // Scan only once the apply page is showing, not the page that is being left (T-113).
      await expect(page).toHaveURL(/\/chef\/apply$/);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await axeClean(page, "/chef/apply");
      for (const path of [
        "/chef/availability",
        "/chef/dishes",
        "/chef/bookings",
      ]) {
        await openPage(page, path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await axeClean(page, path);
      }
    });

    test("chef: a booking page", async ({ page }) => {
      await loginChef(page);
      await openPage(page, "/chef/bookings");
      await expect(page.getByTestId("booking-item").first()).toBeVisible();
      await axeClean(page, "/chef/bookings seeded");
      await openPage(page, `/chef/bookings/${SEEDED.A01}`);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        "Booking from",
      );
      await axeClean(page, "/chef/bookings/[id]");
    });

    test("admin: queue, chef review, bookings, reports, blocks, chat", async ({
      page,
    }) => {
      await loginAdmin(page);
      await axeClean(page, "/admin/chefs");
      await openChef(page, "Linh Nguyen");
      await axeClean(page, "/admin/chefs/[id]");
      for (const [path, finalUrl] of [
        // /admin redirects on the client: scan only once the final page is showing.
        ["/admin", /\/admin\/chefs$/],
        ["/admin/bookings", /\/admin\/bookings$/],
        ["/admin/reports", /\/admin\/reports$/],
        ["/admin/free-trial-blocks", /\/admin\/free-trial-blocks$/],
      ] as const) {
        await openPage(page, path);
        await expect(page).toHaveURL(finalUrl);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await axeClean(page, path);
      }
    });
  });
}

// Interactive states: axe again after the page has changed (errors, open panels, review step).
for (const vp of VIEWPORTS) {
  test.describe(`axe on states at ${vp.name}`, () => {
    test.use({
      viewport: { width: vp.width, height: vp.height },
      colorScheme: vp.dark ? "dark" : "light",
    });

    test("booking form: empty submit errors, then the review step", async ({
      page,
    }) => {
      await signUpCustomer(page);
      await openPage(page, `/chefs/${MAI}/book`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.getByRole("button", { name: "Review my request" }).click();
      await expect(page.getByRole("alert").first()).toBeVisible();
      await axeClean(page, "booking form with errors");
      await page.getByLabel("Date for day 1").selectOption(dayPlus(5));
      await page.getByRole("checkbox", { name: "Pho bo on day 1" }).check();
      await page.getByRole("radio", { name: "At your home" }).check();
      await page.getByRole("radio", { name: "I buy the ingredients" }).check();
      await page.getByRole("checkbox", { name: "I have no allergies" }).check();
      await page
        .getByRole("checkbox", { name: "I have no dietary needs" })
        .check();
      await axeClean(page, "booking form filled with estimate");
      await page.getByRole("button", { name: "Review my request" }).click();
      await expect(page.getByTestId("review-heading")).toBeVisible();
      await axeClean(page, "booking review");
    });

    test("customer booking: cancel panel open, with the reason error", async ({
      page,
    }) => {
      await loginCustomer(page);
      await seedCustomerBookings(page);
      await openPage(page, `/bookings/${SEEDED.A01}`);
      await page.getByRole("button", { name: "Cancel this booking" }).click();
      await expect(
        page.getByRole("heading", { name: "Are you sure?" }),
      ).toBeFocused();
      await axeClean(page, "cancel panel open");
    });

    test("chef: decline panel open, dishes form open with errors", async ({
      page,
    }) => {
      await loginChef(page);
      await openPage(page, `/chef/bookings/${SEEDED.A01}`);
      await page.getByRole("button", { name: "Decline this request" }).click();
      await page.getByRole("button", { name: "Send decline" }).click();
      await axeClean(page, "decline panel with error");
    });

    test("chef dishes: add form with errors", async ({ page }) => {
      await signUpChef(page, "Mai Tran");
      await openPage(page, "/chef/dishes");
      await page.getByRole("button", { name: "Add a dish" }).click();
      await page.getByLabel("Cooking time (minutes)").fill("4");
      await page.getByRole("button", { name: "Add dish" }).click();
      await expect(page.getByLabel("Dish name")).toBeFocused();
      await axeClean(page, "dish form with errors");
    });

    test("admin: reject form with the reason error", async ({ page }) => {
      await loginAdmin(page);
      await openChef(page, "Linh Nguyen");
      await page.getByRole("button", { name: "Reject application" }).click();
      await expect(page.getByText("Enter 3 to 500 characters.")).toBeVisible();
      await axeClean(page, "reject with error");
    });
  });
}

// Keyboard: the skip link, and focus going back after a panel closes. There are no modal dialogs
// in the app (every panel is inline), so there is no Escape handling to test.
test.describe("keyboard", () => {
  test("the skip link is the first Tab stop, shows on focus and moves focus to the page content", async ({
    page,
  }) => {
    await openPage(page, "/login");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    const box = await skip.boundingBox();
    expect(box!.width).toBeGreaterThan(40);
    expect(box!.height).toBeGreaterThan(20);
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
    await expect(page).toHaveURL(/\/login#main-content$/);
    // The next Tab lands on the first field of the form, past the account bar.
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Email")).toBeFocused();
  });

  test("the skip link still works after in-app navigation (one target, no hidden copy)", async ({
    page,
  }) => {
    await openPage(page, "/login");
    await page.getByRole("link", { name: "Sign up" }).first().click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("#main-content")).toHaveCount(1);
    await page.getByRole("link", { name: "Skip to main content" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("radio", { name: /Hire a home cook/ }),
    ).toBeFocused();
  });

  test("Keep my booking gives focus back to the Cancel button", async ({
    page,
  }) => {
    await loginCustomer(page);
    await seedCustomerBookings(page);
    await openPage(page, `/bookings/${SEEDED.A01}`);
    const open = page.getByRole("button", { name: "Cancel this booking" });
    await open.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Are you sure?" }),
    ).toBeFocused();
    await page.getByRole("button", { name: "Keep my booking" }).focus();
    await page.keyboard.press("Enter");
    await expect(open).toBeFocused();
  });

  test("the chef Decline panel: Go back gives focus back to Decline", async ({
    page,
  }) => {
    await loginChef(page);
    await openPage(page, `/chef/bookings/${SEEDED.A01}`);
    const open = page.getByRole("button", { name: "Decline this request" });
    await open.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Why are you declining?")).toBeFocused();
    await page.getByRole("button", { name: "Go back" }).click();
    await expect(open).toBeFocused();
  });

  test("a form error moves focus to the first invalid field (login)", async ({
    page,
  }) => {
    await openPage(page, "/login");
    await page.getByRole("button", { name: "Log in" }).click();
    const focused = await page.evaluate(
      () => document.activeElement?.id ?? document.activeElement?.tagName,
    );
    expect(focused).toBeTruthy();
    await expect(page.getByLabel("Email")).toBeFocused();
  });
});
