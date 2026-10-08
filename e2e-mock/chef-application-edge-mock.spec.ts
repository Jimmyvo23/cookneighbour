import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Tester edge cases for T-033, run against the MOCK adapter (playwright.mock.config.ts).
const PNG = {
  name: "scan.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
};

async function signUpChef(page: Page, name: string) {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill("chef@example.com");
  await page.getByLabel("Password").fill("longenough1");
  await page.getByRole("radio", { name: /chef/ }).check();
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/verify-phone$/);
  await page.getByLabel("Mobile phone number").fill("416 555 0123");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/address$/);
  await page.getByLabel("Street address").fill("1 Main St");
  await page.getByLabel("City").fill("Mississauga");
  await page.getByLabel("Postal code").fill("L5B 1M2");
  await page.getByRole("button", { name: "Save address" }).click();
  await expect(page).toHaveURL(/\/chef\/apply$/);
  await expect(page.getByText("Loading your application")).toHaveCount(0);
}

async function fillProfile(page: Page, chefHome: boolean) {
  await page.getByLabel("Bio").fill("Home cook.");
  await page.getByLabel("Cuisines").fill("Thai");
  await page.getByLabel("Languages you speak").fill("English");
  await page.getByLabel("Hourly rate").fill("30");
  await page.getByLabel("Postal code area you serve").fill("L5B");
  await page.getByLabel("Service radius (km)").fill("10");
  if (chefHome) await page.getByLabel(/At my home/).check();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
}

test("oversized and empty files are refused with focus on the message", async ({
  page,
}) => {
  await signUpChef(page, "Edge Chef");
  const photo = page.getByLabel("Choose a profile photo");
  await photo.setInputFiles({
    name: "big.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await page.getByRole("button", { name: "Upload photo" }).click();
  const tooBig = page.getByRole("alert").filter({ hasText: "too large" });
  await expect(tooBig).toBeFocused();

  await photo.setInputFiles({
    name: "empty.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(0),
  });
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "empty" }),
  ).toBeFocused();

  // A document may be 10 MB but not more; a PDF is fine for documents, not for photos.
  await page.getByLabel("Choose your government ID file").setInputFiles({
    name: "id.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  await page.getByRole("button", { name: "Upload ID" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "too large" }),
  ).toBeFocused();
  await photo.setInputFiles({
    name: "a.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF"),
  });
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "file type is not allowed" }),
  ).toBeFocused();
  await expect(page.getByText("No profile photo yet.")).toBeVisible();
});

test("11th kitchen photo is refused (409) and focus goes to the message", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signUpChef(page, "Photo Chef");
  await fillProfile(page, true);
  await expect(
    page.getByRole("heading", { name: /Your kitchen/ }),
  ).toBeVisible();
  for (let i = 1; i <= 10; i++) {
    await page.getByLabel("Choose a kitchen photo").setInputFiles(PNG);
    await page.getByRole("button", { name: "Add kitchen photo" }).click();
    await expect(page.getByText(`Kitchen photos (${i} of 10)`)).toBeVisible();
  }
  await page.getByLabel("Choose a kitchen photo").setInputFiles(PNG);
  await page.getByRole("button", { name: "Add kitchen photo" }).click();
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "up to 10 kitchen photos" });
  await expect(alert).toBeFocused();
  await expect(alert).toContainText("not added to your application");
  await expect(page.getByText("Kitchen photos (10 of 10)")).toBeVisible();
  await axe(page);
});

test("submit twice and edit after submit keep the application consistent", async ({
  page,
}) => {
  await signUpChef(page, "Mai With Dish");
  await page.getByLabel("Bio").fill("Home cook.");
  await page.getByLabel("Cuisines").fill("Thai");
  await page.getByLabel("Languages you speak").fill("English");
  await page.getByLabel("Hourly rate").fill("30");
  await page.getByLabel("Postal code area you serve").fill("L5B");
  await page.getByLabel("Service radius (km)").fill("10");
  await page.getByLabel(/At the customer/).check();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();
  await page.getByLabel("Choose a profile photo").setInputFiles(PNG);
  await page.getByRole("button", { name: "Upload photo" }).click();
  await page.getByLabel("Choose your government ID file").setInputFiles(PNG);
  await page.getByRole("button", { name: "Upload ID" }).click();
  await expect(page.getByRole("button", { name: "Replace ID" })).toBeVisible();
  await page
    .getByLabel("Choose your Food Handler Certificate file")
    .setInputFiles(PNG);
  await page.getByRole("button", { name: "Upload certificate" }).click();
  await expect(
    page.getByRole("button", { name: "Replace certificate" }),
  ).toBeVisible();
  await page
    .getByLabel("I acknowledge the allergen-awareness statement")
    .check();
  await page.getByRole("button", { name: "Save acknowledgement" }).click();
  await expect(page.getByText("Everything needed is in place.")).toBeVisible();

  const submit = page.getByRole("button", { name: "Submit application" });
  await submit.click();
  await expect(page.getByText(/Submitted\. MOCK/)).toBeVisible();
  const status = page.getByRole("region", { name: /Status/ });
  await expect(status).toContainText("Submitted, waiting for review");
  // Second submit is an idempotent success, not an error.
  await submit.click();
  await expect(page.getByText(/Submitted\. MOCK/)).toBeVisible();
  await expect(
    page.locator("main:visible").getByRole("alert").filter({ hasText: /\S/ }),
  ).toHaveCount(0);

  // Edit after submit: still submitted, never silently draft or approved.
  await page.getByLabel("Bio").fill("Updated bio after submit.");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();
  await expect(status).toContainText("Submitted, waiting for review");
});

test("display name rejects control characters (lessons-learned: unsafe text)", async ({
  page,
}) => {
  await signUpChef(page, "Name Chef");
  await page
    .getByRole("textbox", { name: "Display name" })
    .fill("Mai\u0007Tran");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(
    page.getByRole("textbox", { name: "Display name" }),
  ).toBeFocused();
  await expect(
    page.getByRole("textbox", { name: "Display name" }),
  ).toHaveAttribute("aria-invalid", "true");
});

test("dark mode and 375px with the kitchen section open: axe clean, no scroll", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 375, height: 800 });
  await signUpChef(page, "Dark Chef");
  await fillProfile(page, true);
  await expect(
    page.getByRole("heading", { name: /Your kitchen/ }),
  ).toBeVisible();
  // Show every error state at once so contrast is checked on error colours too.
  await page.getByRole("button", { name: "Save kitchen address" }).click();
  await page.getByLabel("Hourly rate").fill("abc");
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.getByRole("button", { name: "Submit application" }).click();
  await axe(page);
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("keyboard only: every control in every section is reachable by Tab", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await signUpChef(page, "Tab Chef");
  await fillProfile(page, true);
  await expect(
    page.getByRole("heading", { name: /Your kitchen/ }),
  ).toBeVisible();
  const expected = await page
    .locator("main:visible")
    .locator("input:not([disabled]), textarea, button:not([disabled]), a[href]")
    .count();
  await page.locator("main:visible h1").evaluate((h) => {
    h.setAttribute("tabindex", "-1");
    (h as HTMLElement).focus();
  });
  const seen = new Set<string>();
  for (let i = 0; i < expected + 5; i++) {
    await page.keyboard.press("Tab");
    const id = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !el.closest("main")) return "";
      return (
        (el.id || el.getAttribute("name") || "") +
        "|" +
        (el.textContent ?? "").slice(0, 30) +
        "|" +
        Array.from(document.querySelectorAll("main *")).indexOf(el)
      );
    });
    if (id) seen.add(id);
  }
  expect(seen.size).toBe(expected);
});
