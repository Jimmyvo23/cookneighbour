import { expect, test } from "@playwright/test";

test("home page shows the prototype heading", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("CookNeighbour — prototype");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "CookNeighbour — prototype",
  );
});
