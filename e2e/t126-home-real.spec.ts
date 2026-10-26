import { expect, test } from "@playwright/test";

// T-126 v2, real stack: the Mississauga demo pot links to the seeded Chef Lan. The demo seed must
// be loaded (the real CI stack seeds it).
test("Mississauga pot links to Chef Lan", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Pho bo by Chef Lan/ }).click();
  const link = page.getByTestId("pot-card").getByRole("link", {
    name: "See Chef Lan",
  });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/chefs\//);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Chef Lan (demo)",
  );
});
