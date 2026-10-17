import { expect, test } from "@playwright/test";
import {
  SEEDED,
  blockAllStorage,
  expectNoAxeViolations,
  loginChef,
  loginCustomer,
  openPage,
  scrollsSideways,
  setMockHooks,
} from "./helpers";

// T-077 (D-53, D-65, D-66), MOCK mode: a frozen booking (test hook `frozenSeeded`) shows both
// parties one neutral notice and offers no action, except the customer's receipt answers. The
// bookings are made up; nothing is stored outside this tab and no money moves.
const NOTICE =
  "This booking is on hold while an admin looks at it. Nothing can be changed until they decide.";
let storageTried: string[];
test.beforeEach(async ({ page }) => {
  storageTried = await blockAllStorage(page);
});
test.afterEach(() => {
  expect(storageTried).toEqual([]);
});

test("chef: a frozen booking shows the notice and none of the chef's actions", async ({
  page,
}) => {
  await loginChef(page);
  await setMockHooks(page, { frozenSeeded: [SEEDED.A04] });
  await openPage(page, `/chef/bookings/${SEEDED.A04}`);
  await expect(page.getByTestId("loading")).toHaveCount(0);
  await expect(page.getByTestId("frozen-notice")).toContainText(NOTICE);
  await expect(page.getByTestId("frozen-notice")).not.toContainText(
    /reject|flag/i,
  );
  await expect(page.getByRole("button", { name: /Mark day/ })).toHaveCount(0);
  await expect(page.getByTestId("mark-cooked-prompt")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Visit done" })).toHaveCount(0);
  await expect(page.getByTestId("end-booking")).toHaveCount(0);
  await expect(page.getByTestId("receipt-form")).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 800 });
  expect(await scrollsSideways(page)).toBe(false);
  await expectNoAxeViolations(page);
});

test("chef: an unfrozen booking keeps its actions (control)", async ({
  page,
}) => {
  await loginChef(page);
  await openPage(page, `/chef/bookings/${SEEDED.A04}`);
  await expect(page.getByTestId("frozen-notice")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Mark day 1 as cooked/ }),
  ).toBeVisible();
});

test("chef: a frozen chef's-home booking offers no pickup answer", async ({
  page,
}) => {
  await loginChef(page);
  await setMockHooks(page, { frozenSeeded: [SEEDED.A03] });
  await openPage(page, `/chef/bookings/${SEEDED.A03}`);
  await expect(page.getByTestId("frozen-notice")).toBeVisible();
  await expect(page.getByTestId("pickup-respond")).toHaveCount(0);
  await expect(page.getByTestId("missed-pickup")).toHaveCount(0);
});

test("customer: a frozen booking shows the notice, no Cancel, but receipt answers stay", async ({
  page,
}) => {
  await loginCustomer(page);
  await setMockHooks(page, {
    seedCustomer: true,
    frozenSeeded: [SEEDED.A04, SEEDED.A06],
  });
  await openPage(page, `/bookings/${SEEDED.A04}`);
  await expect(page.getByTestId("frozen-notice")).toContainText(NOTICE);
  await expect(
    page.getByRole("button", { name: "Cancel this booking" }),
  ).toHaveCount(0);
  await expectNoAxeViolations(page);

  await openPage(page, `/bookings/${SEEDED.A06}`);
  await expect(page.getByTestId("frozen-notice")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm this amount" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Dispute this receipt" }),
  ).toBeVisible();
});

test("customer: a frozen chef's-home booking offers no pickup proposal", async ({
  page,
}) => {
  await loginCustomer(page);
  await setMockHooks(page, { seedCustomer: true, frozenSeeded: [SEEDED.A05] });
  await openPage(page, `/bookings/${SEEDED.A05}`);
  await expect(page.getByTestId("frozen-notice")).toBeVisible();
  await expect(page.getByTestId("propose-form")).toHaveCount(0);
});

// A05's pickup window is already over in the made-up data, so no clock hook is needed to show
// that the chef's "pickup missed" button is offered when not frozen and hidden when frozen.
test("chef: missed pickup is offered after the window when not frozen (control)", async ({
  page,
}) => {
  await loginChef(page);
  await openPage(page, `/chef/bookings/${SEEDED.A05}`);
  await expect(page.getByTestId("frozen-notice")).toHaveCount(0);
  await expect(page.getByTestId("missed-pickup")).toBeVisible();
});

test("chef: missed pickup is hidden on a frozen booking whose window is over", async ({
  page,
}) => {
  await loginChef(page);
  await setMockHooks(page, { frozenSeeded: [SEEDED.A05] });
  await openPage(page, `/chef/bookings/${SEEDED.A05}`);
  await expect(page.getByTestId("frozen-notice")).toBeVisible();
  await expect(page.getByTestId("missed-pickup")).toHaveCount(0);
});

// T-082 (D-76), MOCK mode: the list rows agree with the detail page about "On hold".
test("customer list: a frozen booking shows On hold, an unfrozen one does not", async ({
  page,
}) => {
  await loginCustomer(page);
  await setMockHooks(page, { seedCustomer: true, frozenSeeded: [SEEDED.A04] });
  await openPage(page, "/bookings");
  const rows = page.getByTestId("booking-item");
  await expect(rows.first()).toBeVisible();
  await expect(page.getByTestId("on-hold")).toHaveCount(1);
  await expect(rows.filter({ has: page.getByTestId("on-hold") })).toHaveCount(
    1,
  );
  await expect(page.getByTestId("on-hold")).toHaveText("On hold");
  await expectNoAxeViolations(page);
});

test("chef list: a frozen booking shows On hold, an unfrozen one does not", async ({
  page,
}) => {
  await loginChef(page);
  await setMockHooks(page, { frozenSeeded: [SEEDED.A04] });
  await openPage(page, "/chef/bookings");
  await expect(page.getByTestId("booking-item").first()).toBeVisible();
  await expect(page.getByTestId("on-hold")).toHaveCount(1);
  await expect(page.getByTestId("on-hold")).toHaveText("On hold");
  await expectNoAxeViolations(page);
});
