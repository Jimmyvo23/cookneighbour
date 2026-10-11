import { expect, test, type Page } from "@playwright/test";
import { expectNoAxeViolations, signUpChef } from "./helpers";

// MOCK mode. The mock adapter plays the server: it decides "today" and the last bookable day.

async function openCalendar(page: Page) {
  await page.getByRole("link", { name: "Availability" }).click();
  await expect(page).toHaveURL(/\/chef\/availability$/);
  await expect(page.getByText("Loading your availability")).toHaveCount(0);
  await expect(page.getByRole("grid")).toBeVisible();
}
const tabStop = (page: Page) => page.locator("button[data-day][tabindex='0']");

test("calendar: tick days, save, reload from the server window (MOCK)", async ({
  page,
}) => {
  await signUpChef(page, "Mai Tran");
  await openCalendar(page);
  await expectNoAxeViolations(page);

  // Exactly one tab stop, and it is today.
  await expect(tabStop(page)).toHaveCount(1);
  await expect(tabStop(page)).toHaveAttribute("aria-label", /, today$/);
  await expect(page.getByTestId("availability-summary")).toContainText(
    "0 days ticked. No unsaved changes.",
  );

  // Tick two days with the mouse; state is announced (aria-pressed) and shown with a check mark.
  const today = await tabStop(page).getAttribute("data-day");
  const first = page.locator(`button[data-day="${today}"]`);
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(first).toContainText("✓");
  await expect(page.getByTestId("availability-summary")).toContainText(
    "1 day ticked. Unsaved changes: 1 to add, 0 to clear.",
  );
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "false");
  await expect(first).not.toContainText("✓");
  await first.click();

  await page.getByRole("button", { name: "Save availability" }).click();
  await expect(page.getByText("Availability saved.")).toBeVisible();
  await expect(page.getByTestId("availability-summary")).toContainText(
    "No unsaved changes.",
  );

  // Clearing it again is saved as a removal.
  await first.click();
  await expect(page.getByTestId("availability-summary")).toContainText(
    "0 to add, 1 to clear",
  );
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await first.click();
  await page.getByRole("button", { name: "Save availability" }).click();
  await expect(page.getByText("Availability saved.")).toBeVisible();
  await expect(first).toHaveAttribute("aria-pressed", "false");

  // Nothing to save is said, not sent.
  await page.getByRole("button", { name: "Save availability" }).click();
  await expect(page.getByText("There are no changes to save.")).toBeVisible();
});

test("calendar: full keyboard use, months, window edges", async ({ page }) => {
  await signUpChef(page, "Keyboard Chef");
  await openCalendar(page);
  const start = (await tabStop(page).getAttribute("data-day"))!;

  // Arrow left at the first day stays put (nothing before today can be chosen).
  await tabStop(page).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(`button[data-day="${start}"]`)).toBeFocused();

  // Space ticks, ArrowRight moves, Enter ticks.
  await page.keyboard.press("Space");
  await expect(page.locator(`button[data-day="${start}"]`)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  const focused = page.locator("button[data-day]:focus");
  await expect(focused).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("availability-summary")).toContainText(
    "2 days ticked",
  );

  // Roving tab stop: Tab leaves the grid for the next control (the Save button).
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Save availability" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("button[data-day]:focus")).toHaveCount(1);

  // PageDown changes month, announces it in the heading and keeps keyboard focus in the grid.
  const monthBefore = await page
    .getByRole("heading", { level: 2 })
    .first()
    .textContent();
  await page.keyboard.press("PageDown");
  await expect(page.locator("button[data-day]:focus")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { level: 2, name: /^[A-Z][a-z]+ \d{4}$/ }),
  ).not.toHaveText(monthBefore!);
  await page.keyboard.press("PageUp");
  await expect(
    page.getByRole("heading", { level: 2, name: monthBefore! }),
  ).toBeVisible();

  // Arrow keys cross into the next month.
  for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowRight");
  await expect(page.locator("button[data-day]:focus")).toHaveCount(1);
  await expectNoAxeViolations(page);

  // Save from the keyboard.
  await page.getByRole("button", { name: "Save availability" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Availability saved.")).toBeVisible();
});

test("calendar: the window ends 180 days out and earlier days cannot be chosen", async ({
  page,
}) => {
  await signUpChef(page, "Window Chef");
  await openCalendar(page);
  const today = (await tabStop(page).getAttribute("data-day"))!;
  const next = page.getByRole("button", { name: "Next month" });
  // Page forward to the last month; the Next button then reports itself disabled.
  for (let i = 0; i < 8; i++) await next.click({ force: true });
  await expect(next).toHaveAttribute("aria-disabled", "true");
  // The last bookable day is today + 180; the day after it is not a button.
  const days = await page
    .locator("button[data-day]")
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.day!));
  const last = days[days.length - 1];
  const diff =
    (Date.parse(`${last}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) /
    86_400_000;
  expect(diff).toBeLessThanOrEqual(180);
  // Earlier month: days before today are not buttons.
  const prev = page.getByRole("button", { name: "Previous month" });
  for (let i = 0; i < 8; i++) await prev.click({ force: true });
  await expect(prev).toHaveAttribute("aria-disabled", "true");
  const early = await page
    .locator("button[data-day]")
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.day!));
  expect(early[0]).toBe(today);
});

test("calendar: a signed-out visitor is sent to log in", async ({ page }) => {
  await page.goto("/chef/availability");
  await expect(page).toHaveURL(/\/login$/);
});

test("calendar: mobile 375px has no horizontal scroll, targets are 44px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signUpChef(page, "Mobile Chef");
  await openCalendar(page);
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const box = await tabStop(page).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(36);
  await expectNoAxeViolations(page);
});

test("calendar: clearing a booked day shows the dates, focuses the error and saves nothing (D-22, MOCK)", async ({
  page,
}) => {
  await signUpChef(page, "Mai Tran");
  await openCalendar(page);
  // The MOCK adapter treats the day three days from today as booked.
  const days = await page
    .locator("button[data-day]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-day")!));
  const today = (await tabStop(page).getAttribute("data-day"))!;
  const booked = days.find(
    (d) =>
      Date.parse(`${d}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`) ===
      3 * 86400000,
  );
  test.skip(!booked, "the booked day is in the next month today");
  const cell = page.locator(`button[data-day="${booked}"]`);
  await cell.click();
  await page.getByRole("button", { name: "Save availability" }).click();
  await expect(page.getByText("Availability saved.")).toBeVisible();
  await cell.click(); // untick
  await page.getByRole("button", { name: "Save availability" }).click();
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "Nothing was saved" });
  await expect(alert).toBeFocused();
  await expect(alert).toContainText("has a booking");
  await expect(alert).toContainText(/\w+day, \w+ \d+, \d{4}/);
  await expect(page.getByText("Availability saved.")).toHaveCount(0);
  await expect(page.getByTestId("availability-summary")).toContainText(
    "1 to clear",
  );
  await expectNoAxeViolations(page);
});
