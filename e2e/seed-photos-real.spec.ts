import { expect, test, type Page } from "@playwright/test";
import { chefs } from "../scripts/seed-data";

// T-121: demo step 1 (CLAUDE.md section 12) with the SEEDED data only. The CI `supabase` job runs
// `npm run db:seed -- --local` before this spec. A-20 hides an approved chef who has no photo, so
// without the seed's placeholder photos nothing below is listed. The job also runs this spec once
// more after clearing every photo_path and requires it to FAIL (bite test, see ci.yml).
// All people and checks here are fictional / MOCK seed data.
const LAN = chefs.find((c) => c.key === "lan-vietnamese")!;
const approved = chefs.filter((c) => c.status === "approved");
const hidden = chefs.filter((c) => c.status !== "approved");

/** Every chef name the public search returns for `qs`, page by page. */
async function allNames(page: Page, qs: string): Promise<string[]> {
  const names: string[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 30; i++) {
    const r = await page.request.get(
      `/api/chefs?${qs}&limit=50${cursor ? `&cursor=${cursor}` : ""}`,
    );
    expect(r.status()).toBe(200);
    const body: {
      items: { displayName: string }[];
      nextCursor: string | null;
    } = await r.json();
    names.push(...body.items.map((x) => x.displayName));
    cursor = body.nextCursor;
    if (!cursor) break;
  }
  return names;
}

test("seeded: a customer searches Mississauga for a Vietnamese chef, finds a seeded one with a real photo, and opens the page (demo step 1)", async ({
  page,
}) => {
  const base = (process.env.API_URL ?? "").replace(/\/+$/, "");
  expect(base, "API_URL must point at the local stack").not.toBe("");

  const names = await allNames(page, "city=Mississauga&cuisine=Vietnamese");
  expect(
    names,
    `SEEDED-LISTED: ${LAN.displayName} is listed for Mississauga + Vietnamese`,
  ).toContain(LAN.displayName);

  // The same search on the page.
  await page.goto("/search");
  await expect(
    page.getByRole("heading", { level: 1, name: "Find a home cook" }),
  ).toBeVisible();
  await expect(page.getByLabel("Or a city")).toBeEnabled();
  await page.getByLabel("Or a city").selectOption("Mississauga");
  await page.getByLabel("Cuisine").fill("Vietnamese");
  await page.getByRole("button", { name: "Find chefs" }).click();
  await expect(page.getByTestId("results-status")).toContainText("Showing");
  const link = page.getByRole("link", { name: LAN.displayName, exact: true });
  for (let i = 0; i < 15 && !(await link.isVisible()); i++) {
    const more = page.getByRole("button", { name: "Load more" });
    if (!(await more.isVisible())) break;
    await more.click();
    await page.waitForTimeout(300);
  }
  await expect(link).toBeVisible();
  const card = page.getByTestId("chef-result").filter({ has: link });

  // The photo is a safe public storage URL of the profile-photos bucket, and it really loads.
  const img = card.getByRole("img", { name: `Photo of ${LAN.displayName}` });
  await expect(img).toBeVisible();
  const src = (await img.getAttribute("src")) ?? "";
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  expect(src).toMatch(
    new RegExp(
      `^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/storage/v1/object/public/profile-photos/${uuid}/photo-${uuid}\\.png$`,
    ),
  );
  expect(src).not.toMatch(/\.\.|%2e|\\/i);
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
  const file = await page.request.get(src);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toContain("image/png");

  // The chef page opens with the seeded dishes and their photos.
  await link.click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: LAN.displayName,
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByTestId("dish")).toHaveCount(LAN.dishes.length);
  const dishImg = page
    .getByTestId("dish")
    .first()
    .getByRole("img", { name: /^Photo of / });
  await expect(dishImg).toBeVisible();
  expect(await dishImg.getAttribute("src")).toMatch(
    new RegExp(
      `/storage/v1/object/public/dish-photos/${uuid}/dish-${uuid}\\.png$`,
    ),
  );
  await expect
    .poll(() => dishImg.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
});

test("seeded: every approved seeded chef is listed; pending and rejected seeded chefs stay hidden", async ({
  page,
}) => {
  const names = await allNames(page, "");
  for (const c of approved)
    expect(names, `${c.displayName} should be listed`).toContain(c.displayName);
  for (const c of hidden)
    expect(names, `${c.displayName} must stay hidden`).not.toContain(
      c.displayName,
    );
});
