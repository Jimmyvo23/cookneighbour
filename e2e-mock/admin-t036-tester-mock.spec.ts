import { expect, test, type Page } from "@playwright/test";
import { expectNoAxeViolations, loginAdmin, openChef } from "./helpers";

// Tester (T-036), MOCK mode. Extra edge cases on top of admin-mock.spec.ts. Nothing here verifies
// anything for real.
const MOCK_KEY = "cookneighbour-mock-api-state";
const tid = (page: Page, id: string) =>
  page.getByTestId(id).filter({ visible: true });

async function editMockState(page: Page, edit: string) {
  await page.evaluate(
    ([key, body]) => {
      const s = JSON.parse(sessionStorage.getItem(key)!);
      new Function("s", body)(s);
      sessionStorage.setItem(key, JSON.stringify(s));
    },
    [MOCK_KEY, edit],
  );
}
const LINH = `s.adminQueue.find((c) => c.id.endsWith("901"))`;
const overflow = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

test("the filter you chose is still what the list shows after you come back from a chef", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.getByLabel("Status").selectOption("rejected");
  await openChef(page, "Rosa Lee");
  await page
    .getByRole("link", { name: "Back to the chef applications" })
    .click();
  await expect(page.getByLabel("Status").filter({ visible: true })).toHaveValue(
    "rejected",
  );
  const items = tid(page, "queue-item");
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("Rosa Lee");
  await expect(items.first()).toContainText("Status: Rejected");
});

test("names and bios with markup are plain text in the queue and in the review", async ({
  page,
}) => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await loginAdmin(page);
  await editMockState(
    page,
    `const c = ${LINH};
     c.app.displayName = '<img src=x onerror=alert(1)>Linh';
     c.app.bio = '<script>alert(2)</script><b>bold</b>';`,
  );
  await page.reload();
  const items = tid(page, "queue-item");
  await expect(items.first()).toContainText("<img src=x onerror=alert(1)>Linh");
  await expect(page.locator("main img[src='x']")).toHaveCount(0);
  await openChef(page, "<img src=x onerror=alert(1)>Linh");
  await expect(
    page.getByText("<script>alert(2)</script><b>bold</b>"),
  ).toBeVisible();
  await expect(page.locator("main b")).toHaveCount(0);
  await expect(page.locator("main img[src='x']")).toHaveCount(0);
  expect(dialogs).toEqual([]);
});

test("a very long bio and reason do not break a 375 px screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await loginAdmin(page);
  await editMockState(page, `const c = ${LINH}; c.app.bio = "W".repeat(1500);`);
  await page.reload();
  await openChef(page, "Linh Nguyen");
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  const reason = page.getByLabel("Reason for rejecting (shown to the chef)");
  await reason.fill("R".repeat(500));
  await page.getByRole("button", { name: "Reject application" }).click();
  await expect(tid(page, "chef-status")).toHaveText("Rejected");
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);
});

test("two admins: the second approve gets 409, nothing is saved, focus is on the error and reload shows the new state", async ({
  page,
}) => {
  await loginAdmin(page);
  await openChef(page, "Linh Nguyen");
  await page
    .getByLabel("Government ID check result to record")
    .selectOption("verified");
  await page
    .getByLabel("Food Handler Certificate check result to record")
    .selectOption("verified");
  await page.getByRole("button", { name: "Save MOCK checks" }).click();
  await expect(page.getByText(/MOCK checks saved/)).toBeVisible();
  // Another admin approves in the meantime.
  await editMockState(page, `${LINH}.app.status = "approved";`);
  await page.getByRole("button", { name: "Approve chef" }).click();
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "Nothing was saved" });
  await expect(alert).toBeFocused();
  await expect(alert).toContainText("already approved");
  await page.getByRole("button", { name: "Reload this application" }).click();
  await expect(tid(page, "chef-status")).toHaveText("Approved");
  await expect(tid(page, "decision-state")).toHaveText(
    "This chef is approved.",
  );
  await expect(page.getByRole("button", { name: "Approve chef" })).toHaveCount(
    0,
  );
});

test("a chef who offers chef's home with no kitchen address or photos: kitchen approve lists what is missing in plain words", async ({
  page,
}) => {
  await loginAdmin(page);
  await openChef(page, "Linh Nguyen");
  await editMockState(
    page,
    `const c = ${LINH};
     c.app.kitchenAddress = null; c.app.documents.kitchenPhotoPaths = []; c.app.kitchenHygieneAckAt = null;`,
  );
  await page
    .getByRole("button", { name: "Reload application and file links" })
    .click();
  await expect(page.getByText("No kitchen photos uploaded.")).toBeVisible();
  await expect(page.getByText("Kitchen address: none stored")).toBeVisible();
  await page.getByRole("button", { name: "Approve kitchen (MOCK)" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "Still missing" });
  await expect(alert).toBeFocused();
  await expect(alert).toContainText("kitchen");
  await expect(alert).not.toContainText("kitchenAddress");
  await expect(tid(page, "chef-home-state")).toHaveText("off");
  await expectNoAxeViolations(page);
});

test("links also refresh on tab focus once they are old, and on demand", async ({
  page,
}) => {
  await page.clock.install();
  await loginAdmin(page);
  await openChef(page, "Linh Nguyen");
  const gone = `${LINH}.vanished = ["idDocument"];`;
  await editMockState(page, gone);
  // Young links: a focus event does not refetch (nothing changes yet).
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.clock.runFor(1000);
  await expect(tid(page, "doc-unavailable")).toHaveCount(0);
  // On demand.
  await page
    .getByRole("button", { name: "Reload application and file links" })
    .click();
  await page.clock.runFor(1000);
  await expect(tid(page, "doc-unavailable")).toHaveCount(1);
  await editMockState(page, `${LINH}.vanished = [];`);
  // Old links + tab focus. The timer would already have fired, so freeze it by jumping the clock
  // with setSystemTime (no timers run), then focus the tab.
  await page.clock.setSystemTime(Date.now() + 250_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.clock.runFor(1000);
  await expect(tid(page, "doc-unavailable")).toHaveCount(0);
});

test("the admin link shows only for admins, /admin opens the queue, and other pages still work with the account bar", async ({
  page,
}) => {
  await loginAdmin(page);
  await expect(
    page.getByRole("link", { name: "Chef applications" }).first(),
  ).toBeVisible();
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/chefs$/);
  await page.getByRole("button", { name: "Log out" }).click();
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Chef applications" }),
  ).toHaveCount(0);
  for (const p of ["/", "/login", "/signup"]) {
    await page.goto(p);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
  }
});

test("keyboard only: the checks selects and both kitchen buttons work, and a chef page still opens from a keyboard click", async ({
  page,
}) => {
  await loginAdmin(page);
  await openChef(page, "Linh Nguyen");
  const id = page.getByLabel("Government ID check result to record");
  await id.focus();
  await page.keyboard.type("Verified"); // typeahead on a closed select
  await page.keyboard.press("Tab");
  await expect(
    page.getByLabel("Food Handler Certificate check result to record"),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Police check result to record")).toBeFocused();
  await page.keyboard.press("Tab");
  const save = page.getByRole("button", { name: "Save MOCK checks" });
  await expect(save).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/MOCK checks saved/)).toBeVisible();
  const reject = page.getByRole("button", { name: "Reject kitchen (MOCK)" });
  await reject.focus();
  await page.keyboard.press("Space"); // no note: field error, focus goes to the note
  await expect(page.getByLabel(/Note to the chef/)).toBeFocused();
  await page.keyboard.type("Photos are too dark.");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Approve kitchen (MOCK)" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(reject).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(tid(page, "chef-home-state")).toHaveText("off");
  await expect(page.getByText(/kitchen was rejected/)).toBeVisible();
});

test("status All with Load more while a chef is added keeps every chef once", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.getByLabel("Status").selectOption("all");
  const items = tid(page, "queue-item");
  await expect(items).toHaveCount(20);
  await editMockState(
    page,
    `const c = JSON.parse(JSON.stringify(${LINH}));
     c.id = "00000000-0000-4000-8000-000000000999"; c.app.displayName = "Brand New";
     c.createdAt = "2026-10-20T12:00:00.000Z"; s.adminQueue.push(c);`,
  );
  await page.getByRole("button", { name: "Load more" }).click();
  // 27 chefs existed; the new one is above the first page, so page 2 repeats one row (dropped).
  await expect(items).toHaveCount(27);
  const names = await items.locator("a[data-chef-link]").allTextContents();
  expect(new Set(names).size).toBe(names.length);
});

test("a customer never sees the admin link", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Cathy");
  await page.getByLabel("Email").fill("cathy@example.com");
  await page.getByLabel("Password").fill("longenough1");
  await page.getByRole("radio", { name: /customer/ }).check();
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/verify-phone$/);
  await expect(
    page.getByRole("link", { name: "Chef applications" }),
  ).toHaveCount(0);
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Chef applications" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
});
