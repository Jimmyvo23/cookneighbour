import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  SEEDED,
  blockAllStorage,
  openPage,
  loginCustomer,
  setMockHooks,
  signUpCustomer,
} from "./helpers";

// T-104 (T-052 Reviewer NITs), MOCK mode: the two inline panels the T-052 specs left without a strict
// axe run and a focus check in a browser. (1) The pickup "I picked up my meals" question with its
// "Not yet" button. (2) The saved-profile "Delete saved profile" question with "Keep it". Same strict
// axe tags as t052-tester-mock (WCAG A/AA + best-practice, nothing disabled) at three views.
// Not checked: `aria-atomic="false"` on the refusal alert was not tried with a real screen reader;
// this only proves the markup and the focus order, not what NVDA, VoiceOver or JAWS say.
// Everything here is made up and stays in this tab.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];
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

let storageTried: string[];
test.beforeEach(async ({ page }) => {
  storageTried = await blockAllStorage(page);
});
test.afterEach(() => {
  expect(storageTried).toEqual([]);
});

for (const v of VIEWS) {
  test.describe(`inline panels at ${v.name}`, () => {
    test.use({
      viewport: { width: v.width, height: v.height },
      colorScheme: v.dark ? "dark" : "light",
    });

    test("pickup question: focus on the question, axe clean, Not yet gives focus back", async ({
      page,
    }) => {
      await loginCustomer(page);
      await setMockHooks(page, { seedCustomer: true });
      await openPage(page, `/bookings/${SEEDED.A05}`);
      await expect(page.getByTestId("loading")).toHaveCount(0);
      const open = page.getByRole("button", { name: "I picked up my meals" });
      await open.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("heading", {
          name: "Confirm that you picked up your meals?",
        }),
      ).toBeFocused();
      await expect(page.getByTestId("pickup-confirm")).toBeVisible();
      await axeClean(page, `pickup panel open at ${v.name}`);
      // Keyboard only: Not yet is reachable and closes the panel.
      await page.getByRole("button", { name: "Not yet" }).focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("heading", {
          name: "Confirm that you picked up your meals?",
        }),
      ).toHaveCount(0);
      await expect(open).toBeFocused();
      await axeClean(page, `pickup panel closed at ${v.name}`);
    });

    test("saved-profile delete question: focus on the question, axe clean, Keep it gives focus back, Yes moves focus to the saved line", async ({
      page,
    }) => {
      await signUpCustomer(page);
      await page.goto("/allergies");
      await expect(page.getByTestId("saved-state")).toContainText(
        "Nothing is saved yet",
      );
      await page.getByRole("checkbox", { name: "I have no allergies" }).check();
      await page
        .getByRole("checkbox", { name: "I have no dietary needs" })
        .check();
      await page.getByRole("button", { name: "Save profile" }).click();
      await expect(page.getByTestId("profile-status")).toContainText("Saved");

      const open = page.getByRole("button", { name: "Delete saved profile" });
      await open.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("confirm-delete")).toBeFocused();
      await expect(
        page.getByRole("group", { name: "Confirm delete" }),
      ).toBeVisible();
      await axeClean(page, `delete panel open at ${v.name}`);
      await page.getByRole("button", { name: "Keep it" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("confirm-delete")).toHaveCount(0);
      await expect(open).toBeFocused();

      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Yes, delete it" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("saved-state")).toContainText(
        "Nothing is saved yet",
      );
      await expect(page.getByTestId("saved-state")).toBeFocused();
      await axeClean(page, `after delete at ${v.name}`);
    });
  });
}
