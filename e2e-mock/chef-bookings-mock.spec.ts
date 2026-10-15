import { expect, test } from "@playwright/test";
import {
  SEEDED,
  blockAllStorage,
  editMockState,
  expectNoAxeViolations,
  loginChef,
  openPage,
  scrollsSideways,
  setMockHooks,
  vis,
  PNG,
} from "./helpers";

// T-045, MOCK mode: the chef's booking dashboard against the mock adapter
// (src/lib/mocks/mock-booking-changes.ts). The six requests are made up, dates are relative to
// today, nothing is stored outside this browser tab and no money moves.
let storageTried: string[];

test.beforeEach(async ({ page }) => {
  storageTried = await blockAllStorage(page);
  await loginChef(page);
});
test.afterEach(() => {
  // Receipts are private files: a MOCK page never asks any storage URL for them.
  expect(storageTried).toEqual([]);
});

async function openBooking(page: import("@playwright/test").Page, id: string) {
  await openPage(page, `/chef/bookings/${id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Booking from",
  );
}

test.describe("the list", () => {
  test("groups bookings by what the chef has to do and links to each", async ({
    page,
  }) => {
    await openPage(page, "/chef/bookings");
    await expect(
      page.getByRole("heading", { level: 1, name: "Your bookings" }),
    ).toBeVisible();
    const waiting = page.getByTestId("group-answer");
    await expect(waiting).toContainText("Waiting for your answer (2)");
    await expect(waiting.getByTestId("booking-item")).toHaveCount(2);
    await expect(page.getByTestId("group-upcoming")).toContainText(
      "Accepted (4)",
    );
    // No address, phone or allergy text in a list (contract 7A).
    const text = await page.getByRole("main").innerText();
    expect(text).not.toMatch(/\+1\d{10}|Maple|EpiPen/);
    await expect(
      page.getByRole("link", { name: /Priya Patel/ }),
    ).toHaveAttribute("href", `/chef/bookings/${SEEDED.A01}`);
    await expectNoAxeViolations(page);
  });

  test("the navigation has a Bookings link that marks the current page", async ({
    page,
  }) => {
    await openPage(page, "/chef/bookings");
    await expect(
      page.getByRole("navigation", { name: "Chef pages" }).getByRole("link", {
        name: "Bookings",
      }),
    ).toHaveAttribute("aria-current", "page");
    await page.getByRole("link", { name: /Priya Patel/ }).click();
    await expect(vis(page, "intake")).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Chef pages" }).getByRole("link", {
        name: "Bookings",
      }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("a customer cannot open the chef pages", async ({ page }) => {
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
    await page.goto("/login");
    await page.getByLabel("Email").fill("sam@example.com");
    await page.getByLabel("Password").fill("longenough1");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).not.toHaveURL(/\/login$/);
    await page.goto("/chef/bookings");
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("a waiting request", () => {
  test("shows the intake, the allergy conflict and eat-by dates before the answer, and no address or phone", async ({
    page,
  }) => {
    await openBooking(page, SEEDED.A01);
    await expect(page.getByTestId("status")).toContainText(
      "Waiting for your answer",
    );
    const intake = page.getByTestId("intake");
    await expect(intake).toContainText("peanuts, carries an EpiPen");
    await expect(intake).toContainText("No beef for the children");
    await expect(page.getByTestId("conflicts")).toContainText("Chicken satay");
    await expect(page.getByTestId("trial-label")).toContainText(
      "Labour is free for the customer on this booking (prototype, MOCK).",
    );
    await expect(
      page.getByTestId("trial-label").getByTestId("mock-badge"),
    ).toBeVisible();
    await expect(page.getByTestId("eat-by").first()).toContainText("Eat by");
    await expect(page.getByTestId("address-later")).toContainText(
      "once you accept",
    );
    const text = await page.getByRole("main").innerText();
    expect(text).not.toMatch(/\+1\d{10}|Maple Ave/);
    // The allergy section is above the buttons that answer.
    const intakeY = (await intake.boundingBox())!.y;
    const answerY = (await page.getByTestId("answer").boundingBox())!.y;
    expect(intakeY).toBeLessThan(answerY);
    await expectNoAxeViolations(page);
  });

  test("a chef's-home request tells the chef the kitchen address is shared on accepting and then locked", async ({
    page,
  }) => {
    await openBooking(page, SEEDED.A02);
    await expect(page.getByTestId("kitchen-note")).toContainText(
      "shared with the customer once you accept",
    );
    await expect(page.getByTestId("kitchen-note")).toContainText("locked");
    await page.getByRole("button", { name: "Accept this request" }).click();
    await expect(page.getByTestId("status")).toContainText("You accepted");
    await expect(page.getByTestId("notice")).toBeFocused();
    await expect(page.getByTestId("kitchen-note")).toContainText(
      "can now see your kitchen address",
    );
  });

  test("accept shows the customer's address and phone and moves focus to the announcement", async ({
    page,
  }) => {
    await openBooking(page, SEEDED.A01);
    await page.getByRole("button", { name: "Accept this request" }).click();
    await expect(page.getByTestId("status")).toContainText("You accepted");
    await expect(page.getByTestId("cooking-place")).toContainText("Maple Ave");
    await expect(page.getByTestId("contact")).toContainText("+1416555");
    await expect(page.getByTestId("notice")).toBeFocused();
    await expect(page.getByTestId("answer")).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test("a chef's-home request the kitchen of which was switched off cannot be accepted, in words", async ({
    page,
  }) => {
    await openPage(page, "/chef/bookings");
    await setMockHooks(page, { chefHomeOff: true });
    await openBooking(page, SEEDED.A02);
    await page.getByRole("button", { name: "Accept this request" }).click();
    const alert = page.getByRole("alert").filter({ hasText: "switched off" });
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
    await expect(page.getByTestId("status")).toContainText(
      "Waiting for your answer",
    );
  });

  test("a chef's-home request with no kitchen address cannot be accepted: the words point to Decline (D-59)", async ({
    page,
  }) => {
    await openPage(page, "/chef/bookings");
    await setMockHooks(page, { kitchenAddressMissing: true });
    await openBooking(page, SEEDED.A02);
    await page.getByRole("button", { name: "Accept this request" }).click();
    const alert = page
      .getByRole("alert")
      .filter({ hasText: "kitchen address is missing" });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("declining this request");
    await expect(alert).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Decline this request" }),
    ).toBeVisible();
  });

  test("decline needs a reason (D-34): the field is marked and focused, nothing is sent", async ({
    page,
  }) => {
    await openBooking(page, SEEDED.A01);
    await page.getByRole("button", { name: "Decline this request" }).click();
    const reason = page.getByLabel("Why are you declining?");
    await expect(reason).toBeFocused();
    await page.getByRole("button", { name: "Send decline" }).click();
    await expect(reason).toHaveAttribute("aria-invalid", "true");
    await expect(reason).toBeFocused();
    await expect(page.getByText("Tell the customer why")).toBeVisible();
    await expect(page.getByTestId("status")).toContainText(
      "Waiting for your answer",
    );
    await expectNoAxeViolations(page);
  });

  test("a reason with a phone number is refused", async ({ page }) => {
    await openBooking(page, SEEDED.A01);
    await page.getByRole("button", { name: "Decline this request" }).click();
    await page
      .getByLabel("Why are you declining?")
      .fill("call me 416 555 0100");
    await page.getByRole("button", { name: "Send decline" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "phone numbers" }),
    ).toBeVisible();
    await expect(page.getByLabel("Why are you declining?")).toBeFocused();
  });

  test("decline with a reason closes the request and shows the reason", async ({
    page,
  }) => {
    await openBooking(page, SEEDED.A01);
    await page.getByRole("button", { name: "Decline this request" }).click();
    await page.getByLabel("Why are you declining?").fill("I am away that week");
    await page.getByRole("button", { name: "Send decline" }).click();
    await expect(page.getByTestId("status")).toContainText("declined");
    await expect(page.getByTestId("declined")).toContainText(
      "I am away that week",
    );
    await expect(page.getByTestId("notice")).toBeFocused();
    await expect(page.getByTestId("groceries")).toHaveCount(0);
    await page.goto("/chef/bookings");
    await expect(page.getByTestId("group-answer")).toContainText("(1)");
  });

  test("the whole answer works with the keyboard", async ({ page }) => {
    await openBooking(page, SEEDED.A02);
    await page.getByRole("button", { name: "Decline this request" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Why are you declining?")).toBeFocused();
    await page.keyboard.type("Too far for me");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Send decline" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("status")).toContainText("declined");
  });
});

test.describe("cooking and finishing", () => {
  test("a day can be marked cooked from its date; completing needs every day", async ({
    page,
  }) => {
    await openBooking(page, SEEDED.A04); // day 1 today, day 2 tomorrow
    await expect(page.getByTestId("cooked-later")).toContainText(
      "You can mark this day as cooked on",
    );
    await expect(
      page.getByRole("button", { name: "Mark day 2 as cooked" }),
    ).toHaveCount(0);
    await expect(page.getByTestId("finish")).toContainText(
      "Mark every day as cooked first",
    );
    await page.getByRole("button", { name: "Mark day 1 as cooked" }).click();
    await expect(page.getByTestId("cooked")).toContainText("Cooked on");
    await expect(page.getByTestId("notice")).toBeFocused();
    await expect(page.getByRole("button", { name: "Visit done" })).toHaveCount(
      0,
    );
  });

  test("visit done completes a booking whose days are cooked", async ({
    page,
  }) => {
    await openBooking(page, SEEDED.A06);
    await page.getByRole("button", { name: "Visit done" }).click();
    await expect(page.getByTestId("status")).toContainText("Completed");
    await expect(page.getByTestId("notice")).toBeFocused();
    await expect(page.getByTestId("finish")).toHaveCount(0);
  });
});

test.describe("pickups (D-29)", () => {
  test("the chef answers the customer's proposed time and sees the history", async ({
    page,
  }) => {
    await openBooking(page, SEEDED.A03);
    await expect(page.getByTestId("pickup-history")).toContainText(
      "you declined",
    );
    await expect(page.getByTestId("pickup-respond")).toContainText("proposes");
    await expectNoAxeViolations(page);
    await page.getByRole("button", { name: "Accept this time" }).click();
    await expect(page.getByTestId("pickup-agreed")).toContainText(
      "Pickup agreed",
    );
    await expect(page.getByTestId("notice")).toBeFocused();
    await expect(page.getByTestId("pickup-respond")).toHaveCount(0);
  });

  test("declining a time leaves the customer able to propose another", async ({
    page,
  }) => {
    await openBooking(page, SEEDED.A03);
    await page.getByRole("button", { name: "Decline this time" }).click();
    await expect(page.getByTestId("pickup-history")).toContainText(
      "you declined",
    );
    await expect(page.getByTestId("pickup-respond")).toHaveCount(0);
    await expect(
      page.getByText("Waiting for the customer to propose"),
    ).toBeVisible();
  });

  test("pickup missed: only after the window, asks first, closes the booking", async ({
    page,
  }) => {
    await openBooking(page, SEEDED.A03);
    await expect(page.getByTestId("missed-pickup")).toHaveCount(0);
    await openBooking(page, SEEDED.A05);
    await page.getByRole("button", { name: "Mark pickup missed" }).click();
    const confirm = page.getByRole("heading", {
      name: "Mark the pickup as missed?",
    });
    await expect(confirm).toBeFocused();
    await expectNoAxeViolations(page);
    await page.getByRole("button", { name: "Keep waiting" }).click();
    await expect(page.getByTestId("status")).toContainText("You accepted");
    await page.getByRole("button", { name: "Mark pickup missed" }).click();
    await page.getByRole("button", { name: "Yes, mark pickup missed" }).click();
    await expect(page.getByTestId("status")).toContainText("customer no-show");
    await expect(page.getByTestId("no-show")).toContainText("pickup as missed");
    await expect(page.getByTestId("notice")).toBeFocused();
  });
});

test.describe("groceries", () => {
  test("option A: the shopping list per dish and the chef's wording of the plan", async ({
    page,
  }) => {
    await openBooking(page, SEEDED.A03); // option A at the chef's home
    await expect(page.getByTestId("shopping-dish")).toHaveCount(1);
    await expect(page.getByTestId("shopping-total")).toContainText("$22.00");
    await expect(page.getByTestId("plan-note")).toContainText(
      "delivers or sends them to your home",
    );
    await expect(page.getByTestId("receipts")).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test("option B: the chef sends a receipt; a far-off amount is flagged for the customer", async ({
    page,
  }) => {
    await openBooking(page, SEEDED.A04);
    await expect(page.getByTestId("no-receipt")).toBeVisible();
    await page.getByRole("button", { name: "Send receipt" }).click();
    const file = page.getByLabel(/Receipt file/);
    await expect(file).toHaveAttribute("aria-invalid", "true");
    await expect(file).toBeFocused();
    await expect(
      page.getByText("Choose the receipt file first."),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    await file.setInputFiles(PNG);
    await page.getByLabel(/Amount you paid/).fill("120");
    await expect(page.getByTestId("receipt-preview")).toContainText(
      "will be flagged",
    );
    await page.getByRole("button", { name: "Send receipt" }).click();
    await expect(page.getByTestId("groceries-notice")).toContainText(
      "Receipt sent",
    );
    await expect(page.getByTestId("groceries-notice")).toBeFocused();
    await expect(page.getByTestId("receipt-amount")).toContainText("$120.00");
    await expect(page.getByTestId("receipt-flag")).toContainText(
      "more than the estimate",
    );
    await expect(page.getByTestId("receipt-status")).toContainText(
      "Waiting for the customer to confirm",
    );
    await expect(page.getByTestId("receipt-form")).toHaveCount(0);
    await expect(
      page.getByTestId("reimbursement").getByTestId("mock-badge"),
    ).toBeVisible();
    await expect(page.getByTestId("no-file-link")).toContainText("MOCK");
    await expectNoAxeViolations(page);
  });

  test("an amount close to the estimate is not flagged", async ({ page }) => {
    await openBooking(page, SEEDED.A04);
    await page.getByLabel(/Receipt file/).setInputFiles(PNG);
    await page.getByLabel(/Amount you paid/).fill("68.50");
    await page.getByRole("button", { name: "Send receipt" }).click();
    await expect(page.getByTestId("receipt-amount")).toContainText("$68.50");
    await expect(page.getByTestId("receipt-flag")).toHaveCount(0);
  });

  test("a wrong file type is refused before anything is sent", async ({
    page,
  }) => {
    await openBooking(page, SEEDED.A04);
    await page.getByLabel(/Receipt file/).setInputFiles({
      name: "a.gif",
      mimeType: "image/gif",
      buffer: Buffer.from("GIF89a"),
    });
    await page.getByLabel(/Amount you paid/).fill("50");
    await page.getByRole("button", { name: "Send receipt" }).click();
    await expect(page.getByText("That file type is not allowed")).toBeVisible();
    await expect(page.getByLabel(/Receipt file/)).toBeFocused();
    await expect(page.getByTestId("receipt")).toHaveCount(0);
  });

  test("a waiting flagged receipt (made up) is shown to the chef with MOCK", async ({
    page,
  }) => {
    await openBooking(page, SEEDED.A06);
    await expect(page.getByTestId("receipt-flag")).toContainText("$22.00 more");
    await expect(page.getByTestId("receipt-flag")).toContainText("$6.00");
    await expect(page.getByTestId("reimbursement")).toContainText(
      "Not recorded yet",
    );
    await expect(page.getByTestId("receipt-form")).toHaveCount(0);
  });
});

test.describe("kitchen address lock", () => {
  async function saveKitchen(
    page: import("@playwright/test").Page,
    line: string,
  ) {
    // The chef already offers cooking at home (the saved profile), so the kitchen section shows.
    await editMockState(page, (st) => {
      st.chef.locationOptions = ["customer_home", "chef_home"];
    });
    await openPage(page, "/chef/apply");
    await page.getByLabel("Kitchen street address").fill(line);
    await page.getByLabel("Kitchen city").fill("Mississauga");
    await page.getByLabel("Kitchen postal code").fill("L5B 1M2");
    await page.getByRole("button", { name: "Save kitchen address" }).click();
  }

  test("tells the chef the address is shared on accepting and locked while a booking is accepted", async ({
    page,
  }) => {
    await editMockState(page, (st) => {
      st.chef.locationOptions = ["customer_home", "chef_home"];
    });
    await openPage(page, "/chef/apply");
    await expect(
      page.getByText(/shared with a customer only after you accept/),
    ).toBeVisible();
    await expect(
      page.getByText(/locked while you have an accepted booking/),
    ).toBeVisible();
  });

  test("with no accepted booking at the chef's home the address can be saved", async ({
    page,
  }) => {
    await saveKitchen(page, "5 Oak Ave");
    await expect(page.getByText("Kitchen address saved.")).toBeVisible();
  });

  test("with an accepted booking at the chef's home a changed address is refused in words (409 kitchen_in_use)", async ({
    page,
  }) => {
    await openPage(page, "/chef/bookings"); // brings in the made-up accepted bookings
    await expect(page.getByTestId("group-upcoming")).toBeVisible();
    await saveKitchen(page, "5 Oak Ave");
    const alert = page
      .getByRole("alert")
      .filter({ hasText: "cannot be changed until that booking is finished" });
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
    await expectNoAxeViolations(page);
  });
});

test.describe("small screens and dark mode", () => {
  test("375 px: list, request and receipt have no sideways scroll and stay axe clean", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    for (const path of [
      "/chef/bookings",
      `/chef/bookings/${SEEDED.A01}`,
      `/chef/bookings/${SEEDED.A06}`,
      `/chef/bookings/${SEEDED.A03}`,
    ]) {
      await openPage(page, path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByText("Loading")).toHaveCount(0);
      expect(await scrollsSideways(page), path).toBe(false);
      await expectNoAxeViolations(page);
    }
  });

  test("dark mode: list, request and receipt are axe clean", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    for (const path of [
      "/chef/bookings",
      `/chef/bookings/${SEEDED.A01}`,
      `/chef/bookings/${SEEDED.A06}`,
      `/chef/bookings/${SEEDED.A05}`,
    ]) {
      await openPage(page, path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByText("Loading")).toHaveCount(0);
      await expectNoAxeViolations(page);
    }
  });
});
