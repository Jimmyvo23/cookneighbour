import { expect, test, type Page } from "@playwright/test";
import { SEEDED, blockAllStorage, loginChef, openPage, PNG } from "./helpers";

// T-045 Tester additions (MOCK mode): hidden page copies, double clicks, anonymous visitors,
// tolerance edge, stale page. Nothing here touches hosted data.
let storageTried: string[];
test.beforeEach(async ({ page }) => {
  storageTried = await blockAllStorage(page);
});
test.afterEach(() => {
  expect(storageTried).toEqual([]);
});

/** Real error alerts: the framework's route announcer and empty live regions are not errors. */
const alerts = (page: Page) =>
  page
    .locator('[role="alert"]:not(#__next-route-announcer__)')
    .filter({ hasText: /\S/ });

/** Ids that appear more than once in the whole document (hidden copies included). */
async function duplicateIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const seen = new Map<string, number>();
    document
      .querySelectorAll("[id]")
      .forEach((e) => seen.set(e.id, (seen.get(e.id) ?? 0) + 1));
    return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  });
}

test("an anonymous visitor sees no booking data on the chef pages", async ({
  page,
}) => {
  await openPage(page, `/chef/bookings/${SEEDED.A01}`);
  await expect(page.getByText("Priya Patel")).toHaveCount(0);
  await expect(page.getByText(/peanut/i)).toHaveCount(0);
  await openPage(page, "/chef/bookings");
  await expect(page.getByText("Priya Patel")).toHaveCount(0);
});

test.describe("signed in as the demo chef", () => {
  test.beforeEach(async ({ page }) => {
    await loginChef(page);
  });

  test("moving between list and several requests in the app never repeats an id", async ({
    page,
  }) => {
    await openPage(page, "/chef/bookings");
    await page
      .getByRole("link", { name: /Priya Patel/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Booking from",
    );
    await page.goBack();
    // A second request through client-side navigation keeps the first copy mounted but hidden.
    const links = page.locator('a[href^="/chef/bookings/"]');
    await expect(links.first()).toBeVisible();
    const hrefs = await links.evaluateAll((a) =>
      a.map((x) => (x as HTMLAnchorElement).getAttribute("href")),
    );
    const other = hrefs.find((h) => h && !h.endsWith(SEEDED.A01));
    expect(other).toBeTruthy();
    await page.evaluate(
      (h) =>
        (
          window as unknown as { next: { router: { push(u: string): void } } }
        ).next.router.push(h as string),
      other,
    );
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Booking from",
    );
    expect(await duplicateIds(page)).toEqual([]);
  });

  test("a double click on Accept ends in the accepted state with no error", async ({
    page,
  }) => {
    await openPage(page, `/chef/bookings/${SEEDED.A01}`);
    // MOCK answers inside the page, so count through the accept button disappearing: a second
    // click must never produce an error alert.
    const accept = page.getByRole("button", { name: /^Accept/ });
    await accept.dblclick();
    await expect(page.getByTestId("notice")).toBeFocused();
    await expect(alerts(page)).toHaveCount(0);
    await expect(page.getByTestId("status")).toContainText("accepted");
  });

  test("a double click on Send receipt registers one receipt", async ({
    page,
  }) => {
    await openPage(page, `/chef/bookings/${SEEDED.A04}`);
    await page.getByLabel(/Receipt file/).setInputFiles(PNG);
    await page.getByLabel(/Amount you paid/).fill("69");
    await page.getByRole("button", { name: "Send receipt" }).dblclick();
    await expect(page.getByTestId("groceries-notice")).toContainText(
      "Receipt sent",
    );
    await expect(alerts(page)).toHaveCount(0);
    await expect(page.getByTestId("receipt-amount")).toHaveCount(1);
  });

  test("an amount exactly at the tolerance is not flagged; one cent over is", async ({
    page,
  }) => {
    // A04: estimated groceries $69.00, tolerance max(15%, $5) = $10.35.
    await openPage(page, `/chef/bookings/${SEEDED.A04}`);
    await page.getByLabel(/Receipt file/).setInputFiles(PNG);
    await page.getByLabel(/Amount you paid/).fill("79.35");
    await expect(page.getByTestId("receipt-preview")).not.toContainText(
      "will be flagged",
    );
    await page.getByLabel(/Amount you paid/).fill("79.36");
    await expect(page.getByTestId("receipt-preview")).toContainText(
      "will be flagged",
    );
  });

  test("a stale request (answered in another tab) explains itself and keeps focus on the alert", async ({
    page,
  }) => {
    await openPage(page, `/chef/bookings/${SEEDED.A01}`);
    await expect(page.getByRole("button", { name: /^Accept/ })).toBeVisible();
    // Answer it behind the page's back through the same MOCK state.
    await page.evaluate(() => {
      const key = "cookneighbour-mock-api-state";
      const s = JSON.parse(sessionStorage.getItem(key) ?? "{}");
      for (const r of s.chefBookings ?? [])
        if (r.detail.id.endsWith("9101")) r.detail.status = "accepted";
      sessionStorage.setItem(key, JSON.stringify(s));
    });
    await page.getByRole("button", { name: /^Accept/ }).click();
    await expect(alerts(page).first()).toBeFocused();
    await expect(alerts(page)).not.toHaveText("");
  });
});
