import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Runs against the MOCK adapter (playwright.mock.config.ts sets NEXT_PUBLIC_API_MOCK=1).
// Chef display names are magic in mock mode (see src/lib/mocks/mock-adapter.ts):
// "with dish" -> the chef already has a sample dish; "rejected" / "approved" -> that status.
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
  await expect(
    page.getByRole("heading", { level: 1, name: "Chef application" }),
  ).toBeVisible();
  await expect(page.getByText("Loading your application")).toHaveCount(0);
}

async function expectNoAxeViolations(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
}

test("chef fills in the whole application and submits (MOCK)", async ({
  page,
}) => {
  await signUpChef(page, "Mai With Dish");
  await expectNoAxeViolations(page);

  // MOCK badge on every check status.
  const status = page.getByRole("region", { name: /Status/ });
  await expect(status.getByTestId("mock-badge")).toHaveCount(3);
  await expect(status).toContainText("Draft, not submitted yet");
  await expect(status).toContainText("Government ID check");
  await expect(status).toContainText(
    "Police check (not run in this prototype)",
  );

  // Submit too early: contract error with the list, focus on the message.
  await page.getByRole("button", { name: "Submit application" }).click();
  const submitAlert = page
    .getByRole("alert")
    .filter({ hasText: "not complete" });
  await expect(submitAlert).toBeFocused();
  await expect(submitAlert).toContainText("A short bio");
  await expect(page.getByTestId("missing-list")).toContainText(
    "A profile photo",
  );

  // Profile: a bad rate puts focus on that field.
  await page.getByLabel("Bio").fill("I cook Vietnamese home food.");
  await page.getByLabel("Cuisines").fill("Vietnamese, Thai");
  await page.getByLabel("Languages you speak").fill("English, Vietnamese");
  await page.getByLabel("Hourly rate").fill("abc");
  await page.getByLabel("Postal code area you serve").fill("L5B");
  await page.getByLabel("Service radius (km)").fill("15");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByLabel("Hourly rate")).toBeFocused();
  await expect(page.getByLabel("Hourly rate")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.getByLabel("Hourly rate").fill("28.50");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();

  // Wrong file type: clear error, focus on the message, nothing uploaded.
  await page.getByLabel("Choose a profile photo").setInputFiles({
    name: "x.gif",
    mimeType: "image/gif",
    buffer: Buffer.from("GIF89a"),
  });
  await page.getByRole("button", { name: "Upload photo" }).click();
  const typeAlert = page
    .getByRole("alert")
    .filter({ hasText: "file type is not allowed" });
  await expect(typeAlert).toBeFocused();
  // No file at all.
  await page.getByLabel("Choose your government ID file").focus();
  await page.getByRole("button", { name: "Upload ID" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Choose a file first." }),
  ).toBeFocused();

  await page.getByLabel("Choose a profile photo").setInputFiles(PNG);
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(page.getByText("A profile photo is saved.")).toBeVisible();

  await page.getByLabel("Choose your government ID file").setInputFiles(PNG);
  await page.getByRole("button", { name: "Upload ID" }).click();
  await expect(page.getByText("Uploaded and saved.").first()).toBeVisible();
  await page
    .getByLabel("Choose your Food Handler Certificate file")
    .setInputFiles({ ...PNG, name: "cert.pdf", mimeType: "application/pdf" });
  await page.getByRole("button", { name: "Upload certificate" }).click();
  await expect(
    page.getByRole("button", { name: "Replace certificate" }),
  ).toBeVisible();

  // Allergen acknowledgement needs the box.
  await page.getByRole("button", { name: "Save acknowledgement" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Tick the box" }),
  ).toBeFocused();
  await page
    .getByLabel("I acknowledge the allergen-awareness statement")
    .check();
  await page.getByRole("button", { name: "Save acknowledgement" }).click();
  await expect(page.getByText(/Acknowledged on/)).toBeVisible();

  // Chef's home: kitchen section appears and adds three required items.
  await expect(page.getByRole("heading", { name: /Your kitchen/ })).toHaveCount(
    0,
  );
  await page.getByLabel(/At my home/).check();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(
    page.getByRole("heading", { name: /Your kitchen/ }),
  ).toBeVisible();
  await expect(page.getByTestId("missing-list")).toContainText(
    "Your kitchen address",
  );
  await expect(status.getByTestId("mock-badge")).toHaveCount(4);

  await page.getByLabel("Kitchen street address").fill("5 Oak Ave");
  await page.getByLabel("Kitchen city").fill("Mississauga");
  await page.getByLabel("Kitchen postal code").fill("V6B 1A1");
  await page.getByRole("button", { name: "Save kitchen address" }).click();
  await expect(page.getByLabel("Kitchen postal code")).toBeFocused();
  await page.getByLabel("Kitchen postal code").fill("L5B 1A1");
  await page.getByRole("button", { name: "Save kitchen address" }).click();
  await expect(page.getByText("Kitchen address saved.")).toBeVisible();

  await page.getByLabel("Choose a kitchen photo").setInputFiles(PNG);
  await page.getByRole("button", { name: "Add kitchen photo" }).click();
  await expect(
    page.getByText("Kitchen photo 1", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove kitchen photo 1" }).click();
  await expect(page.getByText("Kitchen photo 1 removed.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Kitchen photos/ }),
  ).toBeFocused();
  await page.getByLabel("Choose a kitchen photo").setInputFiles(PNG);
  await page.getByRole("button", { name: "Add kitchen photo" }).click();
  await expect(
    page.getByText("Kitchen photo 1", { exact: true }),
  ).toBeVisible();

  await page.getByLabel("I acknowledge the kitchen-hygiene statement").check();
  await page.getByRole("button", { name: "Save acknowledgement" }).click();

  await expect(page.getByText("Everything needed is in place.")).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(page.getByText(/Submitted\. MOCK/)).toBeVisible();
  await expect(status).toContainText("Submitted, waiting for review");
  await expect(status).toContainText("Pending review");
  await expect(status.getByText("Pending review")).toHaveCount(3);
});

test("keyboard only: fill and save the profile form", async ({ page }) => {
  await signUpChef(page, "Keyboard Chef");
  await page.getByLabel("Bio").focus();
  await page.keyboard.type("Home cook.");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Thai");
  await page.keyboard.press("Tab");
  await page.keyboard.type("English");
  await page.keyboard.press("Tab");
  await page.keyboard.type("30");
  await page.keyboard.press("Tab");
  await page.keyboard.type("l5b");
  await page.keyboard.press("Tab");
  await page.keyboard.type("12");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Profile saved.")).toBeVisible();
  await expect(page.getByLabel("Postal code area you serve")).toHaveValue(
    "l5b",
  );
});

test("a rejected chef sees the reason and can submit again", async ({
  page,
}) => {
  await signUpChef(page, "Rejected Chef");
  const status = page.getByRole("region", { name: /Status/ });
  await expect(status).toContainText("Not approved");
  await expect(status).toContainText(
    "MOCK: the ID photo was too blurry to read.",
  );
  await expect(
    page.getByRole("button", { name: "Submit again" }),
  ).toBeVisible();
  await expectNoAxeViolations(page);
});

test("an approved chef cannot submit again", async ({ page }) => {
  await signUpChef(page, "Approved Chef");
  await expect(page.getByRole("region", { name: /Status/ })).toContainText(
    "Approved",
  );
  await expect(
    page.getByRole("button", { name: "Already approved" }),
  ).toBeDisabled();
});

test("signed-out visitors and customers cannot use /chef/apply", async ({
  page,
}) => {
  await page.goto("/chef/apply");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Cathy");
  await page.getByLabel("Email").fill("cathy@example.com");
  await page.getByLabel("Password").fill("longenough1");
  await page.getByRole("radio", { name: /customer/ }).check();
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/verify-phone$/);
  await page.goto("/chef/apply");
  await expect(page).toHaveURL(/\/$/);
});

test("mobile 375px: no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signUpChef(page, "Mobile Chef");
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);
});
