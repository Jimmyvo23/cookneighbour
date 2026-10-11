import { expect, test, type Page } from "@playwright/test";
import { PNG, signUpChef, blockStorage } from "./helpers";

test.beforeEach(async ({ page }) => {
  await blockStorage(page);
});

// Round 2 (tester): an uploaded dish photo is kept when only the save failed (here: the 50 active
// dish cap, a 409), and replaced when the chef picks a new file. Every upload makes one fresh
// crypto.randomUUID() for its file name, so the calls are counted to see whether a second upload
// happened. The mock "server" makes a dish id with randomUUID only when a create succeeds.

const OTHER = { ...PNG, name: "other.png" };

async function fillFiftyDishes(page: Page) {
  await page.getByRole("link", { name: "Dishes" }).click();
  await expect(page.getByText("Loading your dishes")).toHaveCount(0);
  for (let i = 0; i < 50; i++) {
    await page.getByRole("button", { name: "Add a dish" }).click();
    await page.getByLabel("Dish name").fill(`Dish ${i}`);
    await page.getByLabel("Cuisine", { exact: true }).fill("Thai");
    await page.getByLabel("Cooking time (minutes)").fill("30");
    await page.getByRole("button", { name: "Add dish" }).click();
    await expect(page.getByText(`Dish ${i} was added.`)).toBeVisible();
  }
}

const uuids = (page: Page) =>
  page.evaluate(() => (window as unknown as { __uuids: string[] }).__uuids);

async function openOverCapEditor(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __uuids: string[] };
    w.__uuids = [];
    const real = crypto.randomUUID.bind(crypto);
    crypto.randomUUID = (() => {
      const u = real();
      w.__uuids.push(u);
      return u;
    }) as typeof crypto.randomUUID;
  });
  await signUpChef(page, "Retry Chef");
  await fillFiftyDishes(page);
  await page.evaluate(
    () => ((window as unknown as { __uuids: string[] }).__uuids.length = 0),
  );
  await page.getByRole("button", { name: "Add a dish" }).click();
  await page.getByLabel("Dish name").fill("With photo");
  await page.getByLabel("Cuisine", { exact: true }).fill("Thai");
  await page.getByLabel("Cooking time (minutes)").fill("30");
  await page.getByLabel("Dish photo").setInputFiles(PNG);
  await page.getByRole("button", { name: "Add dish" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "50 active dishes" });
  await expect(alert).toBeFocused();
  expect(await uuids(page)).toHaveLength(1); // one upload so far
}

async function freeOnePlace(page: Page) {
  await page.getByRole("button", { name: "Deactivate Dish 0" }).click();
  await expect(page.getByText("Dish 0 is now inactive.")).toBeVisible();
}

const storedPhoto = (page: Page) =>
  page.evaluate(() => {
    const s = JSON.parse(
      sessionStorage.getItem("cookneighbour-mock-api-state")!,
    );
    return s.dishes.find((d: { name: string }) => d.name === "With photo")
      ?.photoPath as string | undefined;
  });

test("a 409 keeps the uploaded photo: the retry does not upload again", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openOverCapEditor(page);
  const first = (await uuids(page))[0];
  // Second 409 with the same file: still one upload.
  await page.getByRole("button", { name: "Add dish" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "50 active dishes" }),
  ).toBeFocused();
  expect(await uuids(page)).toEqual([first]);
  // Free a place and retry: saved with the first upload's name; only the dish id is new.
  await freeOnePlace(page);
  await page.getByRole("button", { name: "Add dish" }).click();
  await expect(page.getByText("With photo was added.")).toBeVisible();
  expect(await uuids(page)).toHaveLength(2);
  expect(await storedPhoto(page)).toContain(first);
});

test("choosing a new file after a failed save uploads the new file", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openOverCapEditor(page);
  const first = (await uuids(page))[0];
  await freeOnePlace(page);
  await page.getByLabel("Dish photo").setInputFiles(OTHER);
  await page.getByRole("button", { name: "Add dish" }).click();
  await expect(page.getByText("With photo was added.")).toBeVisible();
  const all = await uuids(page);
  expect(all).toHaveLength(3); // first upload, second upload, dish id
  const stored = await storedPhoto(page);
  expect(stored).toContain(all[1]);
  expect(stored).not.toContain(first);
});

test("disabled-looking buttons: aria-disabled month and busy buttons are dimmed", async ({
  page,
}) => {
  await signUpChef(page, "Dim Chef");
  await page.getByRole("link", { name: "Availability" }).click();
  await expect(page.getByRole("grid")).toBeVisible();
  const prev = page.getByRole("button", { name: "Previous month" });
  await expect(prev).toHaveAttribute("aria-disabled", "true");
  await expect(prev).toHaveCSS("opacity", "0.6");
  await expect(prev).toHaveCSS("cursor", "not-allowed");
  const next = page.getByRole("button", { name: "Next month" });
  await expect(next).not.toHaveAttribute("aria-disabled", "true");
  await expect(next).toHaveCSS("opacity", "1");
});
