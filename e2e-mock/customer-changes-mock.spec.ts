import { expect, test, type Page } from "@playwright/test";
import {
  SEEDED,
  blockAllStorage,
  dayPlus,
  editMockState,
  expectNoAxeViolations,
  loginCustomer,
  openPage,
  scrollsSideways,
  seedCustomerBookings,
} from "./helpers";

// T-045, MOCK mode: the customer's side of pickups (D-29) and groceries. The bookings are made up
// by the MOCK hook `seedCustomer`, because in mock mode nobody answers a customer's requests.
// Nothing is stored outside this browser tab and no money moves.
let storageTried: string[];

test.beforeEach(async ({ page }) => {
  storageTried = await blockAllStorage(page);
  await loginCustomer(page);
  await seedCustomerBookings(page);
});
test.afterEach(() => {
  expect(storageTried).toEqual([]);
});

async function open(page: Page, id: string) {
  await openPage(page, `/bookings/${id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Booking with",
  );
  await expect(page.getByTestId("loading")).toHaveCount(0);
}

/** Makes the open proposal of A03 a declined one, so the customer may propose again. */
async function declineOpenProposal(page: Page) {
  await editMockState(page, (st) => {
    for (const r of st.bookings)
      if (r.detail.id.endsWith("9103"))
        for (const p of r.detail.days[0].pickups)
          if (p.status === "proposed") p.status = "declined";
  });
}

test.describe("pickups", () => {
  test("a chef's-home booking shows the pickup rules, the history and no form while a time waits", async ({
    page,
  }) => {
    await open(page, SEEDED.A03);
    await expect(
      page.getByRole("heading", { name: "Picking up your meals" }),
    ).toBeVisible();
    await expect(page.getByTestId("pickup-missed-warning")).toContainText(
      "no-show by you for the whole booking",
    );
    await expect(page.getByTestId("pickup-history")).toContainText(
      "the chef declined",
    );
    await expect(page.getByTestId("pickup-history")).toContainText(
      "waiting for the chef to answer",
    );
    await expect(page.getByTestId("propose-form")).toHaveCount(0);
    // The chef's kitchen address and phone are shown once accepted (6.8).
    await expect(page.getByTestId("cooking-place")).toContainText("Kitchen Rd");
    await expect(page.getByTestId("contact")).toContainText("+14165550100");
    await expectNoAxeViolations(page);
  });

  test("not shown for a booking at the customer's home", async ({ page }) => {
    await open(page, SEEDED.A04);
    await expect(page.getByTestId("pickups")).toHaveCount(0);
  });

  test("after a decline the customer proposes again; the time goes out as Toronto time and focus moves to the notice", async ({
    page,
  }) => {
    await declineOpenProposal(page);
    await open(page, SEEDED.A03);
    await expect(page.getByTestId("propose-form")).toBeVisible();
    await page
      .getByLabel(/Propose a new pickup time for day 1/)
      .fill(`${dayPlus(1)}T15:30`);
    await page.getByRole("button", { name: "Propose this time" }).click();
    await expect(page.getByTestId("notice")).toContainText(
      "Pickup time proposed for day 1",
    );
    await expect(page.getByTestId("notice")).toBeFocused();
    await expect(page.getByTestId("propose-form")).toHaveCount(0);
    await expect(page.getByTestId("pickup-history")).toContainText("3:30");
    await expect(page.getByTestId("pickup-history")).toContainText(
      "Toronto time",
    );
    await expectNoAxeViolations(page);
  });

  test("an empty time is refused with the field marked and focused", async ({
    page,
  }) => {
    await declineOpenProposal(page);
    await open(page, SEEDED.A03);
    await page.getByRole("button", { name: "Propose this time" }).click();
    const field = page.getByLabel(/Propose a new pickup time/);
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toBeFocused();
    await expectNoAxeViolations(page);
  });

  test("a time after the end of the pickup window shows the reason and the latest moment", async ({
    page,
  }) => {
    await declineOpenProposal(page);
    await open(page, SEEDED.A03);
    const field = page.getByLabel(/Propose a new pickup time/);
    await field.fill(`${dayPlus(4)}T10:00`);
    await page.getByRole("button", { name: "Propose this time" }).click();
    const alert = page.getByRole("alert").filter({ hasText: "no later than" });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/Choose a time before .*Toronto time/);
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toBeFocused();
    await expect(page.getByTestId("propose-form")).toBeVisible();
  });

  test("a time in the past is refused", async ({ page }) => {
    await declineOpenProposal(page);
    await open(page, SEEDED.A03);
    await page
      .getByLabel(/Propose a new pickup time/)
      .fill(`${dayPlus(-1)}T10:00`);
    await page.getByRole("button", { name: "Propose this time" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "future" }),
    ).toBeVisible();
  });

  test("after the deadline there is no form, only an explanation", async ({
    page,
  }) => {
    await open(page, SEEDED.A05);
    await expect(page.getByTestId("propose-form")).toHaveCount(0);
    await expect(page.getByTestId("pickup-window-over")).toContainText(
      "no pickup was agreed",
    );
  });

  test("an agreed pickup is shown", async ({ page }) => {
    await editMockState(page, (st) => {
      for (const r of st.bookings)
        if (r.detail.id.endsWith("9103"))
          for (const p of r.detail.days[0].pickups)
            if (p.status === "proposed") p.status = "accepted";
    });
    await open(page, SEEDED.A03);
    await expect(page.getByTestId("pickup-agreed")).toContainText(
      "Pickup agreed",
    );
    await expect(page.getByTestId("propose-form")).toHaveCount(0);
  });

  test("when the chef marked the pickup missed, the booking says so", async ({
    page,
  }) => {
    await editMockState(page, (st) => {
      for (const r of st.bookings)
        if (r.detail.id.endsWith("9105")) {
          r.detail.status = "no_show_customer";
          r.detail.noShow = {
            reportedAt: new Date().toISOString(),
            dayNumber: 1,
            pickupMissed: true,
          };
        }
    });
    await open(page, SEEDED.A05);
    await expect(page.getByTestId("status")).toContainText("no-show");
    await expect(page.getByText(/meals not picked up/)).toBeVisible();
  });
});

test.describe("groceries", () => {
  test("option A at the chef's home: the list per dish and the customer's note", async ({
    page,
  }) => {
    await open(page, SEEDED.A03);
    await expect(page.getByTestId("shopping-dish")).toHaveCount(1);
    await expect(page.getByTestId("shopping-total")).toContainText("$22.00");
    await expect(page.getByTestId("plan-note")).toContainText(
      "deliver or send them to the chef's home",
    );
    await expect(page.getByTestId("receipts")).toHaveCount(0);
  });

  test("option B with no receipt yet", async ({ page }) => {
    await open(page, SEEDED.A04);
    await expect(page.getByTestId("no-receipt")).toContainText(
      "The chef has not added a receipt yet",
    );
    await expect(page.getByTestId("receipt-form")).toHaveCount(0);
  });

  test("a flagged receipt shows the difference and the tolerance, MOCK reimbursement, and needs an answer", async ({
    page,
  }) => {
    await open(page, SEEDED.A06);
    const flag = page.getByTestId("receipt-flag");
    await expect(flag).toContainText("$22.00 more than the estimate");
    await expect(flag).toContainText("$6.00");
    await expect(flag).toContainText("needs your answer");
    await expect(page.getByTestId("receipt-status")).toContainText(
      "Waiting for your answer",
    );
    await expect(
      page.getByTestId("reimbursement").getByTestId("mock-badge"),
    ).toBeVisible();
    await expect(page.getByTestId("reimbursement")).toContainText(
      "Not recorded yet",
    );
    await expect(page.getByTestId("no-file-link")).toContainText("MOCK");
    await expectNoAxeViolations(page);
  });

  test("confirm records the MOCK reimbursement and moves focus to the announcement", async ({
    page,
  }) => {
    await open(page, SEEDED.A06);
    await page.getByRole("button", { name: "Confirm this amount" }).click();
    await expect(page.getByTestId("groceries-notice")).toContainText(
      "You confirmed the receipt",
    );
    await expect(page.getByTestId("groceries-notice")).toBeFocused();
    await expect(page.getByTestId("receipt-status")).toContainText(
      "You confirmed this receipt",
    );
    await expect(page.getByTestId("reimbursement")).toContainText(
      "Recorded: $62.00",
    );
    await expect(page.getByTestId("reimbursement")).toContainText(
      "Nothing was collected",
    );
    await expect(page.getByTestId("receipt-answer")).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test("dispute needs a note of 3 to 300 characters", async ({ page }) => {
    await open(page, SEEDED.A06);
    await page.getByRole("button", { name: "Dispute this receipt" }).click();
    const note = page.getByLabel("What is wrong with this receipt?");
    await expect(note).toBeFocused();
    await page.getByRole("button", { name: "Send dispute" }).click();
    await expect(note).toHaveAttribute("aria-invalid", "true");
    await expect(note).toBeFocused();
    await expectNoAxeViolations(page);
    await note.fill("ab");
    await page.getByRole("button", { name: "Send dispute" }).click();
    await expect(note).toHaveAttribute("aria-invalid", "true");
    await note.fill("The total looks too high for this list");
    await page.getByRole("button", { name: "Send dispute" }).click();
    await expect(page.getByTestId("groceries-notice")).toContainText(
      "You disputed the receipt",
    );
    await expect(page.getByTestId("receipt-status")).toContainText(
      "You disputed this receipt",
    );
    await expect(page.getByTestId("dispute-note")).toContainText(
      "The total looks too high",
    );
  });

  test("a receipt that was answered elsewhere shows the reason in words", async ({
    page,
  }) => {
    await open(page, SEEDED.A06);
    await expect(
      page.getByRole("button", { name: "Confirm this amount" }),
    ).toBeVisible();
    // Someone (another tab) already confirmed it: change the saved receipt behind the page.
    await editMockState(page, (st) => {
      for (const r of st.receipts["00000000-0000-4000-8000-000000009106"])
        r.status = "confirmed";
    });
    await page.getByRole("button", { name: "Confirm this amount" }).click();
    const alert = page
      .getByRole("alert")
      .filter({ hasText: "already answered" });
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
  });
});

test.describe("privacy and layout", () => {
  test("a waiting request at the chef's home shows no kitchen address or phone", async ({
    page,
  }) => {
    await open(page, SEEDED.A02);
    await expect(page.getByTestId("kitchen-later")).toContainText(
      "once the chef accepts",
    );
    const text = await page.getByRole("main").innerText();
    expect(text).not.toMatch(/Kitchen Rd|\+1\d{10}/);
  });

  test("375 px and dark mode: no sideways scroll, axe clean", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    for (const id of [SEEDED.A03, SEEDED.A06, SEEDED.A04]) {
      await open(page, id);
      await expect(page.getByTestId("groceries")).toBeVisible();
      await expect(page.getByText("Loading the groceries")).toHaveCount(0);
      expect(await scrollsSideways(page), id).toBe(false);
      await expectNoAxeViolations(page);
    }
    await page.emulateMedia({ colorScheme: "dark" });
    for (const id of [SEEDED.A03, SEEDED.A06]) {
      await open(page, id);
      await expect(page.getByText("Loading the groceries")).toHaveCount(0);
      await expectNoAxeViolations(page);
    }
  });
});
