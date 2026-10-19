import { expect, test } from "@playwright/test";
import {
  SEEDED,
  blockAllStorage,
  expectNoAxeViolations,
  loginChef,
  loginCustomer,
  openPage,
  setMockHooks,
  dayPlus,
} from "./helpers";
import type { Page } from "@playwright/test";

const KEY = "cookneighbour-mock-api-state";

/** Changes the saved MOCK booking behind the open page, as if the other person had acted. */
async function editBooking(
  page: Page,
  list: "chefBookings" | "bookings",
  id: string,
  edit: string,
) {
  await page.evaluate(
    ([key, listName, bookingId, code]) => {
      const s = JSON.parse(sessionStorage.getItem(key)!);
      const row = s[listName].find(
        (x: { detail: { id: string } }) => x.detail.id === bookingId,
      );
      new Function("d", code)(row.detail);
      sessionStorage.setItem(key, JSON.stringify(s));
    },
    [KEY, list, id, edit],
  );
}

// T-080: a stale page. The chef opens the booking, then the customer confirms the pickup (here the
// MOCK hook `pickedUpSeeded` stands in for that, set after the page loaded). The chef's "Mark
// pickup missed" is then refused with 409 pickup_confirmed. The page must refetch (the dead
// button goes), keep the explaining alert, and leave focus on it. MOCK data only, no clock needed.
let storageTried: string[];
test.beforeEach(async ({ page }) => {
  storageTried = await blockAllStorage(page);
});
test.afterEach(() => {
  expect(storageTried).toEqual([]);
});

test("chef: stale 'Mark pickup missed' -> 409 -> button gone, alert focused", async ({
  page,
}) => {
  await loginChef(page);
  await openPage(page, `/chef/bookings/${SEEDED.A05}`);
  await page.getByRole("button", { name: "Mark pickup missed" }).click();
  await expect(page.getByTestId("missed-pickup")).toBeVisible();
  // The customer confirms the pickup while this page is still open.
  await editBooking(
    page,
    "chefBookings",
    SEEDED.A05,
    // T-081: the server completes a booking once every day is picked up, so a stale-page 409
    // pickup_confirmed needs another open day: day 1 is confirmed, a day 2 is still to cook.
    `const f = d.days[0]; const gap = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000); const add = (a, n) => new Date(Date.parse(a + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10); const date2 = ${JSON.stringify(dayPlus(2))}; d.days = [{ ...f, pickedUpAt: f.cookedAt }, { ...f, dayNumber: 2, date: date2, cookedAt: null, pickedUpAt: null, pickups: [], pickupDeadlineDate: add(date2, gap(f.date, f.pickupDeadlineDate)), dishes: f.dishes.map((x) => ({ ...x, eatByDate: add(date2, gap(f.date, x.eatByDate)) })) }];`,
  );
  await page.getByRole("button", { name: "Yes, mark pickup missed" }).click();

  const alert = page.getByTestId("refusal");
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(alert).toBeFocused();
  // The page refetched: the dead action is gone and the confirmation is shown.
  await expect(page.getByTestId("missed-pickup")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /mark pickup missed/i }),
  ).toHaveCount(0);
  await expect(page.getByTestId("picked-up")).toBeVisible();
  // The message survived the reload and is still the focused element.
  await expect(alert).toBeFocused();
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(
    1,
  );
  await expectNoAxeViolations(page);
});

test("customer: stale 'I picked up my meals' after the chef closed the booking -> button gone, alert focused", async ({
  page,
}) => {
  await loginCustomer(page);
  await setMockHooks(page, { seedCustomer: true });
  await openPage(page, `/bookings/${SEEDED.A05}`);
  await page.getByRole("button", { name: "I picked up my meals" }).click();
  // Meanwhile the chef marked the pickup as missed: the booking is a customer no-show.
  await editBooking(
    page,
    "bookings",
    SEEDED.A05,
    'd.status = "no_show_customer"; d.noShow = { reportedAt: new Date().toISOString(), dayNumber: 1, pickupMissed: true };',
  );
  await page.getByRole("button", { name: "Yes, I picked them up" }).click();
  const alert = page.getByTestId("refusal");
  await expect(alert).toBeFocused();
  await expect(page.getByRole("button", { name: /I picked up/ })).toHaveCount(
    0,
  );
  await expect(page.getByTestId("status")).toContainText(/no-show/i);
  await expect(alert).toBeFocused();
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(
    1,
  );
});

test("customer: stale receipt 'Confirm this amount' -> 409 -> receipt list reloads, buttons gone, alert focused", async ({
  page,
}) => {
  await loginCustomer(page);
  await setMockHooks(page, { seedCustomer: true });
  await openPage(page, `/bookings/${SEEDED.A06}`);
  const confirm = page.getByRole("button", { name: "Confirm this amount" });
  await expect(confirm).toBeVisible();
  // Meanwhile the receipt was answered elsewhere (a second tab). The booking status is unchanged.
  await page.evaluate(
    ([key, id]) => {
      const s = JSON.parse(sessionStorage.getItem(key)!);
      s.receipts[id] = s.receipts[id].map((r: { status: string }) => ({
        ...r,
        status: "confirmed",
      }));
      sessionStorage.setItem(key, JSON.stringify(s));
    },
    [KEY, SEEDED.A06],
  );
  await confirm.click();
  const alert = page.getByTestId("refusal");
  await expect(alert).toBeFocused();
  await expect(confirm).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Dispute this receipt/ }),
  ).toHaveCount(0);
  await expect(alert).toBeFocused();
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(
    1,
  );
});
