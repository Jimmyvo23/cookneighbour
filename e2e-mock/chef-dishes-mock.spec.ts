import { expect, test } from "@playwright/test";
import { PNG, expectNoAxeViolations, signUpChef } from "./helpers";

// MOCK mode (playwright.mock.config.ts). Dish routes are served by the mock adapter.

async function openDishes(page: import("@playwright/test").Page) {
  await page.getByRole("link", { name: "Dishes" }).click();
  await expect(page).toHaveURL(/\/chef\/dishes$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Your dishes" }),
  ).toBeVisible();
  await expect(page.getByText("Loading your dishes")).toHaveCount(0);
}

test("chef adds, edits, deactivates and reactivates a dish (MOCK)", async ({
  page,
}) => {
  await signUpChef(page, "Mai Tran");
  await openDishes(page);
  await expectNoAxeViolations(page);
  await expect(page.getByText("You have no dishes yet")).toBeVisible();
  await expect(page.getByTestId("active-count")).toHaveText(
    "0 of 50 active dishes.",
  );

  await page.getByRole("button", { name: "Add a dish" }).click();
  await expect(
    page.getByRole("heading", { name: "Add a dish", level: 2 }),
  ).toBeFocused();
  await expectNoAxeViolations(page);

  // Bad values: focus goes to the first invalid field, messages are the shared ones.
  await page.getByLabel("Cooking time (minutes)").fill("4");
  await page.getByLabel("Estimated ingredient cost").fill("abc");
  await page.getByLabel("Servings").fill("51");
  await page.getByRole("button", { name: "Add dish" }).click();
  await expect(page.getByLabel("Dish name")).toBeFocused();
  await expect(page.getByLabel("Dish name")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.getByText(/5 to 360/).first()).toBeVisible();
  await expect(page.getByText(/in dollars/).first()).toBeVisible();
  await expectNoAxeViolations(page);

  // Control characters are refused with the shared text rule.
  await page.getByLabel("Dish name").fill("Pho\u0007");
  await page.getByLabel("Cuisine", { exact: true }).fill("Vietnamese");
  await page.getByLabel("Cooking time (minutes)").fill("180");
  await page.getByLabel("Estimated ingredient cost").fill("25.50");
  await page.getByLabel("Servings").fill("4");
  await page.getByRole("button", { name: "Add dish" }).click();
  await expect(page.getByLabel("Dish name")).toBeFocused();
  await expect(
    page.getByText("Remove control or invalid characters."),
  ).toBeVisible();

  // A wrong photo type is stopped before upload.
  await page.getByLabel("Dish name").fill("Pho bo");
  await page.getByLabel("Dish photo").setInputFiles({
    name: "x.gif",
    mimeType: "image/gif",
    buffer: Buffer.from("GIF89a"),
  });
  await page.getByRole("button", { name: "Add dish" }).click();
  await expect(page.getByLabel("Dish photo")).toBeFocused();
  await expect(page.getByText(/file type is not allowed/)).toBeVisible();

  await page.getByLabel("Dish photo").setInputFiles(PNG);
  await page.getByLabel("Soy", { exact: true }).check();
  await page.getByLabel("Other allergens (optional)").fill("Celery");
  await page.getByRole("button", { name: "Add dish" }).click();
  await expect(page.getByText("Pho bo was added.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Menu", level: 2 }),
  ).toBeFocused();
  const card = page.getByRole("article", { name: /Pho bo/ });
  await expect(card).toContainText("3 h to cook");
  await expect(card).toContainText("$25.50");
  await expect(card).toContainText("Allergens: soy, celery");
  await expect(card.getByTestId("dish-status")).toHaveText("Active");
  await expect(page.getByTestId("dish-photo-fallback")).toBeVisible(); // MOCK: no stored file
  await expect(page.getByTestId("active-count")).toHaveText(
    "1 of 50 active dishes.",
  );
  await expectNoAxeViolations(page);

  // Edit.
  await page.getByRole("button", { name: "Edit Pho bo" }).click();
  await expect(page.getByLabel("Dish name")).toHaveValue("Pho bo");
  await expect(page.getByLabel("Estimated ingredient cost")).toHaveValue(
    "25.50",
  );
  await expect(page.getByLabel("Soy", { exact: true })).toBeChecked();
  await page.getByLabel("Dish name").fill("Pho ga");
  await page.getByRole("button", { name: "Save dish" }).click();
  await expect(page.getByText("Pho ga was saved.")).toBeVisible();

  // Cancel returns focus to the menu.
  await page.getByRole("button", { name: "Edit Pho ga" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Menu" })).toBeFocused();

  // Deactivate, then reactivate (nothing is deleted).
  await page.getByRole("button", { name: "Deactivate Pho ga" }).click();
  await expect(page.getByText("Pho ga is now inactive.")).toBeVisible();
  await expect(page.getByTestId("dish-status")).toHaveText("Inactive");
  await expect(page.getByTestId("active-count")).toHaveText(
    "0 of 50 active dishes.",
  );
  await page.getByRole("button", { name: "Reactivate Pho ga" }).click();
  await expect(page.getByTestId("dish-status")).toHaveText("Active");
  await expect(page.getByRole("button", { name: /Delete/ })).toHaveCount(0);
});

test("dishes: keyboard only, and the application links to the dish editor", async ({
  page,
}) => {
  await signUpChef(page, "Keyboard Chef");
  await expect(page.getByTestId("missing-list")).toContainText(
    "At least one active dish with a photo",
  );
  await expect(page.getByText(/editor is not available/)).toHaveCount(0);
  await page.getByRole("link", { name: "Add a dish" }).click();
  await expect(page).toHaveURL(/\/chef\/dishes$/);
  await page.getByRole("button", { name: "Add a dish" }).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Dish name").focus();
  await page.keyboard.type("Pad thai");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Thai");
  await page.keyboard.press("Tab"); // description
  await page.keyboard.press("Tab");
  await page.keyboard.type("90");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Pad thai was added.")).toBeVisible();
  await page.getByRole("button", { name: "Deactivate Pad thai" }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByText("Pad thai is now inactive.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reactivate Pad thai" }),
  ).toBeFocused();
});

test("the 50 active dish cap shows a clear message and takes focus", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signUpChef(page, "Busy Chef");
  await openDishes(page);
  for (let i = 0; i < 50; i++) {
    await page.getByRole("button", { name: "Add a dish" }).click();
    await page.getByLabel("Dish name").fill(`Dish ${i}`);
    await page.getByLabel("Cuisine", { exact: true }).fill("Thai");
    await page.getByLabel("Cooking time (minutes)").fill("30");
    await page.getByRole("button", { name: "Add dish" }).click();
    await expect(page.getByText(`Dish ${i} was added.`)).toBeVisible();
  }
  await page.getByRole("button", { name: "Add a dish" }).click();
  await page.getByLabel("Dish name").fill("One too many");
  await page.getByLabel("Cuisine", { exact: true }).fill("Thai");
  await page.getByLabel("Cooking time (minutes)").fill("30");
  await page.getByRole("button", { name: "Add dish" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "50 active dishes" });
  await expect(alert).toBeFocused();
  await expect(page.getByLabel("Dish name")).toHaveValue("One too many");
});

test("mobile 375px: dishes page has no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signUpChef(page, "Mobile Chef with dish");
  await openDishes(page);
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("button", { name: "Add a dish" }).click();
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);
});

test("dark mode: dishes and calendar are axe clean; acknowledgement wording has no draft label", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await signUpChef(page, "Dark Chef with dish");
  const body = page.locator("main:visible");
  await expect(body).not.toContainText("Draft wording");
  await expect(body).toContainText("This is not legal advice.");
  await expect(body).toContainText("MOCK: no one checks them automatically");
  await page.getByRole("link", { name: "Dishes" }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expectNoAxeViolations(page);
  await page.getByRole("link", { name: "Availability" }).click();
  await expect(page.getByRole("grid")).toBeVisible();
  await expectNoAxeViolations(page);
});
