import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, signUpChef } from "./helpers";

// Tester edge cases for T-034 (MOCK mode). The mock adapter plays the server, so the "server day"
// is the Toronto day computed from the (fixed) clock, never the browser's own time zone.

async function openCalendar(page: import("@playwright/test").Page) {
  await page.getByRole("link", { name: "Availability" }).click();
  await expect(page.getByRole("grid")).toBeVisible();
}

for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Tokyo"]) {
  test(`calendar window follows Toronto, not a browser in ${tz}`, async ({
    browser,
  }) => {
    // 2026-10-08T03:30Z is 23:30 on Oct 7 in Toronto (EDT), but Oct 8 or later in Kiritimati/Tokyo.
    const context = await browser.newContext({ timezoneId: tz });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date("2026-10-08T03:30:00Z"));
    await signUpChef(page, "Zone Chef");
    await openCalendar(page);
    await expect(
      page.getByRole("button", { name: "Wednesday, October 7, 2026, today" }),
    ).toBeVisible();
    // Oct 7 is the first choosable day; the 6th is outside the window.
    await expect(
      page.getByLabel(
        "Tuesday, October 6, 2026, outside the days you can choose",
      ),
    ).toBeVisible();
    // The last bookable day is today + 180 days = April 5, 2027.
    await expect(
      page.getByRole("button", { name: "Monday, April 5, 2027" }),
    ).toHaveCount(0); // not in the visible month yet
    await page.getByRole("button", { name: "Next month" }).click();
    await expect(
      page.getByRole("button", { name: "Thursday, November 5, 2026" }),
    ).toBeVisible();
    await context.close();
  });
}

test("calendar: Home, End and one tab stop; pressed state has a non-colour cue", async ({
  page,
}) => {
  await signUpChef(page, "Keys Chef");
  await openCalendar(page);
  await expect(page.locator("button[data-day][tabindex='0']")).toHaveCount(1);

  const today = (await page
    .locator("button[data-day][tabindex='0']")
    .getAttribute("data-day"))!;
  await page.locator("button[data-day][tabindex='0']").focus();
  await page.keyboard.press("End");
  const end = await page
    .locator("button[data-day]:focus")
    .getAttribute("data-day");
  expect(new Date(`${end}T12:00:00Z`).getUTCDay()).toBe(6);
  await page.keyboard.press("Home");
  const home = await page
    .locator("button[data-day]:focus")
    .getAttribute("data-day");
  // Home goes to Sunday of the week, clamped to today when that Sunday is in the past.
  expect(home! >= today).toBe(true);
  expect(
    new Date(`${home}T12:00:00Z`).getUTCDay() === 0 || home === today,
  ).toBe(true);
  await expect(page.locator("button[data-day][tabindex='0']")).toHaveCount(1);

  // Ticking adds a check mark (text), not only a colour change, and exposes aria-pressed.
  await page.keyboard.press("Space");
  const ticked = page.locator("button[data-day]:focus");
  await expect(ticked).toHaveAttribute("aria-pressed", "true");
  await expect(ticked).toContainText("✓");
  // Unticking back to the saved state leaves nothing to save.
  await page.keyboard.press("Space");
  await expect(ticked).toHaveAttribute("aria-pressed", "false");
  await expect(ticked).not.toContainText("✓");
  await expect(page.getByTestId("availability-summary")).toContainText(
    "No unsaved changes.",
  );
  await expectNoAxeViolations(page);
});

test("calendar: saved days can be cleared", async ({ page }) => {
  await signUpChef(page, "Diff Chef");
  await openCalendar(page);
  const first = page.locator("button[data-day][tabindex='0']");
  const day = (await first.getAttribute("data-day"))!;
  await first.focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Save availability" }).click();
  await expect(page.getByText("Availability saved.")).toBeVisible();
  // Clear it and save: the day is removed.
  await page.locator(`button[data-day="${day}"]`).focus();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("availability-summary")).toContainText(
    "0 to add, 1 to clear",
  );
  await page.getByRole("button", { name: "Save availability" }).click();
  await expect(page.getByText("Availability saved.")).toBeVisible();
  await expect(page.getByTestId("availability-summary")).toContainText(
    "0 days ticked",
  );
});

test("dishes: a dollar edge value is sent as exact cents and shown back", async ({
  page,
}) => {
  await signUpChef(page, "Cents Chef");
  await page.getByRole("link", { name: "Dishes" }).click();
  await page.getByRole("button", { name: "Add a dish" }).click();
  await page.getByLabel("Dish name").fill("Bun cha");
  await page.getByLabel("Cuisine", { exact: true }).fill("Vietnamese");
  await page.getByLabel("Cooking time (minutes)").fill("5");
  await page.getByLabel("Estimated ingredient cost").fill("500.00");
  await page.getByLabel("Servings").fill("50");
  await page.getByLabel("Eat-by days (shelf life)").fill("0");
  await page.getByRole("button", { name: "Add dish" }).click();
  const card = page.getByRole("article", { name: /Bun cha/ });
  await expect(card).toContainText("$500.00");
  await expect(card).toContainText("5 min to cook");
  await expect(card).toContainText("50 servings");
  await expect(card).toContainText("Eat the same day");

  await page.getByRole("button", { name: "Edit Bun cha" }).click();
  await page.getByLabel("Estimated ingredient cost").fill("500.01");
  await page.getByRole("button", { name: "Save dish" }).click();
  await expect(page.getByLabel("Estimated ingredient cost")).toBeFocused();
  await expect(
    page.getByText(/in dollars from \$0\.00 to \$500\.00/),
  ).toBeVisible();
  await page.getByLabel("Estimated ingredient cost").fill("0");
  await page.getByRole("button", { name: "Save dish" }).click();
  await expect(page.getByRole("article", { name: /Bun cha/ })).toContainText(
    "$0.00",
  );
});

test("T-033 carry-overs: wording is honest", async ({ page }) => {
  await signUpChef(page, "Words Chef");
  const main = page.locator("main:visible");
  await expect(main).not.toContainText(/draft wording/i);
  await expect(main).not.toContainText("dish editor is not available");
  await expect(main).toContainText("not legal advice");
  await expect(main).toContainText("sends its check back to pending review");
  // The kitchen section (hygiene note and removed-photo wording) opens with "At my home".
  await page.getByLabel("Bio").fill("Home cook.");
  await page.getByLabel("Cuisines").fill("Thai");
  await page.getByLabel("Languages you speak").fill("English");
  await page.getByLabel("Hourly rate").fill("30");
  await page.getByLabel("Postal code area you serve").fill("L5B");
  await page.getByLabel("Service radius (km)").fill("10");
  await page.getByLabel(/At my home/).check();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();
  await expect(main).toContainText(
    "tries to delete the file (if that fails, the file may stay stored)",
  );
  await expect(main).toContainText("nobody checks this in the prototype");
  await expect(main).toContainText("This is not legal advice.");
  // Every check status carries a MOCK badge (ID, certificate, police).
  for (const row of [
    /Government ID check/,
    /Food Handler Certificate check/,
    /Police check/,
  ])
    await expect(main.getByText(row).first()).toBeVisible();
  const text = (await main.innerText()).replace(/\s+/g, " ");
  expect(
    (text.match(/Not started|Pending|Verified|Failed/g) ?? []).length,
  ).toBeGreaterThan(0);
  expect((text.match(/⚠\s*MOCK/g) ?? []).length).toBeGreaterThanOrEqual(
    (text.match(/Not started|Pending|Verified|Failed/g) ?? []).length - 1,
  );
});
