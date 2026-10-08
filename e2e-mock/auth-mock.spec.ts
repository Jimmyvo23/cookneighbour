import { expect, test } from "@playwright/test";

// Runs against the MOCK adapter (playwright.mock.config.ts sets NEXT_PUBLIC_API_MOCK=1).
test("sign-up, MOCK phone verify, address", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Mai Tran");
  await page.getByLabel("Email").fill("mai@example.com");
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("Use at least 8 characters.")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeFocused();
  await expect(page.getByLabel("Password")).toHaveAttribute(
    "aria-invalid",
    "true",
  );

  await page.getByLabel("Password").fill("longenough1");
  await page.getByRole("radio", { name: /customer/ }).check();
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page).toHaveURL(/\/verify-phone$/);
  await expect(
    page.getByTestId("mock-badge").filter({ hasText: "no real SMS" }),
  ).toContainText(
    "MOCK — no real SMS is sent; any 6-digit code works in demo mode",
  );
  await page.getByLabel("Mobile phone number").fill("416 555 0123");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("6-digit code").fill("12");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("Enter exactly 6 digits.")).toBeVisible();
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();

  await expect(page).toHaveURL(/\/address$/);
  await expect(page.getByText(/This address is private/)).toBeVisible();
  await page.getByLabel("Street address").fill("1 Main St");
  await page.getByLabel("City").fill("Mississauga");
  await page.getByLabel("Postal code").fill("V6B 1A1");
  await page.getByRole("button", { name: "Save address" }).click();
  await expect(page.getByText("Not a GTA postal code.")).toBeVisible();
  await page.getByLabel("Postal code").fill("L5B 1M2");
  await page.getByRole("button", { name: "Save address" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Signed in as Mai Tran")).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
});

test("login shows wrong-password and rate-limit messages", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("a@example.com");
  await page.getByLabel("Password").fill("wrongpass");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Email or password is incorrect.",
  );
  await page.getByLabel("Email").fill("limited@example.com");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Try again in 2 minutes",
  );
});

test("MOCK API badge is visible on every page", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("MOCK API — no real data")).toBeVisible();
});

test("focus lands on the form after a server error following client navigation", async ({
  page,
}) => {
  await page.goto("/signup");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByLabel("Your name")).toBeFocused();
  await page.getByRole("link", { name: "Log in" }).last().click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email").fill("a@example.com");
  await page.getByLabel("Password").fill("wrongpass");
  await page.getByRole("button", { name: "Log in" }).click();
  const alert = page
    .getByRole("main")
    .getByRole("alert")
    .filter({ hasText: "Email or password is incorrect." });
  await expect(alert).toBeVisible();
  await expect(alert).toBeFocused();
});

test("sign-up with email confirmation on shows check-your-email (signedIn: false)", async ({
  page,
}) => {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Lan Pham");
  await page.getByLabel("Email").fill("confirm@example.com");
  await page.getByLabel("Password").fill("longenough1");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "We sent you a link to confirm your email",
  );
  await expect(page).toHaveURL(/\/signup$/);
  // No session was created: the account bar still offers Log in.
  await expect(
    page.getByRole("link", { name: "Log in" }).first(),
  ).toBeVisible();
  await expect(page.getByText(/Signed in as/)).toHaveCount(0);
});

test("route guards", async ({ page }) => {
  await page.goto("/address");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/verify-phone");
  await expect(page).toHaveURL(/\/login$/);

  // Log in with an unverified phone: sent to /verify-phone.
  await page.getByLabel("Email").fill("a@example.com");
  await page.getByLabel("Password").fill("longenough1");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/verify-phone$/);
  await page.getByLabel("Mobile phone number").fill("416 555 0123");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/address$/);

  // Signed in: /login and /signup go home.
  await page.goto("/login");
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/signup");
  await expect(page).toHaveURL(/\/$/);
});
