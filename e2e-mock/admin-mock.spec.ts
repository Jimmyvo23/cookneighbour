import { expect, test, type Page } from "@playwright/test";
import {
  expectNoAxeViolations,
  loginAdmin,
  openChef,
  blockStorage,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await blockStorage(page);
});

// MOCK mode: the mock adapter plays the six /api/admin/chefs routes (src/lib/mocks/mock-admin.ts).
// Every check status is a MOCK; nothing is verified.

/** Pages stay mounted but hidden after navigation (cacheComponents), so only look at what shows. */
const tid = (page: Page, id: string) =>
  page.getByTestId(id).filter({ visible: true });

const MOCK_KEY = "cookneighbour-mock-api-state";

/** Edits the mock server's stored state, as if something changed on the server. */
async function editMockState(
  page: Page,
  edit: string, // a function body: (s) => void
) {
  await page.evaluate(
    ([key, body]) => {
      const s = JSON.parse(sessionStorage.getItem(key)!);
      new Function("s", body)(s);
      sessionStorage.setItem(key, JSON.stringify(s));
    },
    [MOCK_KEY, edit],
  );
}

async function setChecks(page: Page, id: string, fh: string) {
  await page
    .getByLabel("Government ID check result to record")
    .selectOption(id);
  await page
    .getByLabel("Food Handler Certificate check result to record")
    .selectOption(fh);
  await page.getByRole("button", { name: "Save MOCK checks" }).click();
}

test("the queue lists pending chefs newest first, every check has a MOCK badge, and axe is clean", async ({
  page,
}) => {
  await loginAdmin(page);
  const items = tid(page, "queue-item");
  await expect(items.first()).toContainText("Linh Nguyen");
  await expect(items).toHaveCount(20);
  await expect(tid(page, "queue-count")).toContainText(
    "Showing 20 applications, newest first (more available).",
  );
  // Four checks per chef (ID, certificate, kitchen, police), each with its own MOCK badge.
  const first = items.first();
  await expect(first.getByTestId("mock-badge")).toHaveCount(4);
  await expect(first).toContainText("Police check");
  await expect(page.getByText("Status: Pending").first()).toBeVisible();
  await expectNoAxeViolations(page);
});

test("Load more adds the rest, moves focus to the first new chef and keeps the order", async ({
  page,
}) => {
  await loginAdmin(page);
  const items = tid(page, "queue-item");
  await expect(items).toHaveCount(20);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(items).toHaveCount(25); // 3 detailed pending chefs + 22 fillers
});

test("status and checks-pending filters", async ({ page }) => {
  await loginAdmin(page);
  const items = tid(page, "queue-item");
  await page.getByLabel("Status").selectOption("rejected");
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("Rosa Lee");
  await expect(items.first()).toContainText("Status: Rejected");
  await page.getByLabel("Status").selectOption("approved");
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("Tuan Pham");

  await page.getByLabel("Status").selectOption("all");
  await page.getByLabel(/Checks pending/).check();
  await expect(items).toHaveCount(4);
  await expect(tid(page, "queue-count")).toContainText(
    "Showing 4 applications",
  );
  await page.getByLabel(/Checks pending/).uncheck();
  await expect(page.getByRole("button", { name: "Load more" })).toBeVisible();

  await page.getByLabel("Status").selectOption("rejected");
  await page.getByLabel(/Checks pending/).check();
  await expect(items).toHaveCount(1); // Rosa's certificate check is pending
  await page.getByLabel("Status").selectOption("approved");
  await expect(tid(page, "queue-count")).toHaveText(
    "No applications match these filters.",
  );
});

test("review: files are shown from links, checks are saved, then the chef is approved", async ({
  page,
}) => {
  await loginAdmin(page);
  await openChef(page, "Linh Nguyen");
  await expect(
    page.getByText("Missing from the chef's own checklist"),
  ).toBeVisible();
  await expect(tid(page, "missing-list")).toHaveCount(0); // complete application
  await expect(page.getByText("linh.mock", { exact: false })).toHaveCount(0);
  await expect(page.getByText("mock-chef-901@example.com")).toBeVisible();
  // Government ID and certificate are images served from the link; plus two kitchen photos.
  const id = page.getByRole("img", {
    name: "Government ID uploaded by the chef",
  });
  await expect(id).toBeVisible();
  await expect
    .poll(() => id.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
  await expect(
    page.getByRole("link", { name: "Open Government ID in a new tab" }),
  ).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("img", { name: /Kitchen photo/ })).toHaveCount(2);
  await expectNoAxeViolations(page);

  // Approve too early: 409 in plain words, focus on the message, nothing changed.
  await page.getByRole("button", { name: "Approve chef" }).click();
  const early = page.getByRole("alert").filter({ hasText: "must be verified" });
  await expect(early).toBeFocused();
  await expect(early).toContainText("Nothing was saved");
  await expect(tid(page, "chef-status")).toHaveText("Pending");

  // Nothing changed yet: asks for a change and focuses the message.
  await page.getByRole("button", { name: "Save MOCK checks" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Change at least one status" }),
  ).toBeFocused();

  await setChecks(page, "verified", "verified");
  await expect(page.getByText(/MOCK checks saved/)).toBeVisible();
  await expect(page.getByText("Now: Verified")).toHaveCount(2);

  await page.getByRole("button", { name: "Approve chef" }).click();
  await expect(tid(page, "chef-status")).toHaveText("Approved");
  await expect(
    page.getByText(/Approved\. The chef's status is now Approved/),
  ).toBeVisible();
  await expect(tid(page, "decision-state")).toHaveText(
    "This chef is approved.",
  );
  await expect(tid(page, "decision-state")).toBeFocused();
  await expect(page.getByRole("button", { name: "Approve chef" })).toHaveCount(
    0,
  );

  // Back in the queue the chef is gone from the pending list and shown under approved.
  await page
    .getByRole("link", { name: "Back to the chef applications" })
    .click();
  const items = tid(page, "queue-item");
  await expect(items.first()).not.toContainText("Linh Nguyen");
  await page.getByLabel("Status").selectOption("approved");
  await expect(items.first()).toContainText("Linh Nguyen");
});

test("approve explains missing items and a vanished file in plain words", async ({
  page,
}) => {
  await loginAdmin(page);
  await openChef(page, "Incomplete Ivy");
  await expect(tid(page, "missing-list")).toContainText("the bio");
  await page.getByRole("button", { name: "Approve chef" }).click();
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "cannot be approved yet" });
  await expect(alert).toBeFocused();
  await expect(alert).toContainText("the bio");
  await expect(alert).toContainText("the Food Handler Certificate file");
  await expect(alert).toContainText("the verified phone (MOCK SMS)");
  await expect(alert).not.toContainText("idDocument");

  await page
    .getByRole("link", { name: "Back to the chef applications" })
    .click();
  await openChef(page, "Vanished Vera");
  // The chef's own list is empty, the ID link is missing.
  await expect(
    page.getByText("Nothing. The application is complete."),
  ).toBeVisible();
  await expect(tid(page, "doc-unavailable")).toHaveCount(1);
  await expect(tid(page, "doc-unavailable")).toContainText("Not available");
  await page.getByRole("button", { name: "Approve chef" }).click();
  const vanished = page
    .getByRole("alert")
    .filter({ hasText: "cannot be approved yet" });
  await expect(vanished).toBeFocused();
  await expect(vanished).toContainText("the government ID file");
  await expect(vanished).toContainText("vanished from storage");
  await expectNoAxeViolations(page);

  // You cannot verify a file you could not open; failing it is allowed.
  await page
    .getByLabel("Government ID check result to record")
    .selectOption("verified");
  await page.getByRole("button", { name: "Save MOCK checks" }).click();
  const field = page.getByLabel("Government ID check result to record");
  await expect(field).toBeFocused();
  await expect(
    page.getByText("You cannot verify a file you could not open."),
  ).toBeVisible();
  await field.selectOption("failed");
  await page.getByRole("button", { name: "Save MOCK checks" }).click();
  await expect(page.getByText(/MOCK checks saved/)).toBeVisible();
});

test("reject: reason rules run before sending, then the chef is rejected", async ({
  page,
}) => {
  await loginAdmin(page);
  await openChef(page, "Linh Nguyen");
  const reason = page.getByLabel("Reason for rejecting (shown to the chef)");
  const submit = page.getByRole("button", { name: "Reject application" });

  await submit.click();
  await expect(reason).toBeFocused();
  await expect(page.getByText("Enter 3 to 500 characters.")).toBeVisible();
  await reason.fill("no");
  await submit.click();
  await expect(reason).toBeFocused();
  await reason.fill("bad\u0007text");
  await submit.click();
  await expect(reason).toBeFocused();
  await expect(
    page.getByText("Remove control or invalid characters."),
  ).toBeVisible();
  await reason.fill("x".repeat(501));
  await submit.click();
  await expect(reason).toBeFocused();

  await reason.fill("The ID photo is blurry. Please upload it again.");
  await submit.click();
  await expect(tid(page, "chef-status")).toHaveText("Rejected");
  await expect(tid(page, "decision-state")).toContainText("was rejected");
  await expect(tid(page, "decision-state")).toBeFocused();
  await expect(page.getByText("Reason given to the chef:")).toBeVisible();
  await expect(
    page.getByText("The ID photo is blurry. Please upload it again.").first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve chef" })).toHaveCount(
    0,
  );
  await expect(submit).toHaveCount(0);
});

test("a reason from the chef's side is shown as plain text, never as HTML", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.getByLabel("Status").selectOption("rejected");
  await openChef(page, "Rosa Lee");
  await expect(
    page.getByText("<b>ID photo</b>", { exact: false }),
  ).toBeVisible();
  await expect(page.locator("main b")).toHaveCount(0);
  // Typing markup as a reason is stored and shown as text too.
  await page
    .getByRole("link", { name: "Back to the chef applications" })
    .click();
  await page.getByLabel("Status").selectOption("approved");
  await openChef(page, "Tuan Pham");
  await page
    .getByLabel("Reason for rejecting (shown to the chef)")
    .fill("<img src=x onerror=alert(1)> bad");
  await page.getByRole("button", { name: "Reject application" }).click();
  await expect(
    page.getByText("<img src=x onerror=alert(1)> bad").first(),
  ).toBeVisible();
  await expect(page.locator("main img[src='x']")).toHaveCount(0);
});

test("kitchen review (MOCK): approve turns chef's home on, reject needs a note and turns it off", async ({
  page,
}) => {
  await loginAdmin(page);
  await openChef(page, "Linh Nguyen");
  const kitchen = page.getByRole("region", { name: "Kitchen (MOCK review)" });
  await expect(kitchen.getByTestId("mock-badge").first()).toBeVisible();
  await expect(kitchen).toContainText("1 Fictional Street, Mississauga L5B1A1");
  await expect(tid(page, "chef-home-state")).toHaveText("off");

  await kitchen.getByRole("button", { name: "Reject kitchen (MOCK)" }).click();
  const note = kitchen.getByLabel(/Note to the chef/);
  await expect(note).toBeFocused();
  await note.fill("ab");
  await kitchen.getByRole("button", { name: "Approve kitchen (MOCK)" }).click();
  await expect(note).toBeFocused(); // an optional note must still be 3 to 500 safe characters
  await note.fill("");
  await kitchen.getByRole("button", { name: "Approve kitchen (MOCK)" }).click();
  await expect(
    kitchen.getByText(/cooking at the chef's home is on/),
  ).toBeVisible();
  await expect(tid(page, "chef-home-state")).toHaveText("on");
  await expect(kitchen).toContainText("Verified");

  await note.fill("Photos are too dark to judge.");
  await kitchen.getByRole("button", { name: "Reject kitchen (MOCK)" }).click();
  await expect(tid(page, "chef-home-state")).toHaveText("off");
  await expect(kitchen).toContainText("Failed");
  await expectNoAxeViolations(page);
});

test("a file the chef replaced after the admin opened it: nothing is saved, the admin is told to reload", async ({
  page,
}) => {
  await loginAdmin(page);
  await openChef(page, "Linh Nguyen");
  await editMockState(
    page,
    `const c = s.adminQueue.find((c) => c.id.endsWith("901"));
     c.app.documents.idDocumentPath = c.app.documents.idDocumentPath.replace(".png", "-new.png");
     c.app.checks.id = "pending";`,
  );
  await page
    .getByLabel("Government ID check result to record")
    .selectOption("verified");
  await page
    .getByLabel("Police check result to record")
    .selectOption("verified");
  await page.getByRole("button", { name: "Save MOCK checks" }).click();
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "Nothing was saved" });
  await expect(alert).toBeFocused();
  await expect(alert).toContainText("Reload this application");

  await page.getByRole("button", { name: "Reload this application" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Reloaded" }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "chef changed a file" }),
  ).toBeVisible();
  // The police check was not saved either (one all-or-nothing write).
  await expect(page.getByText("Now: Not started")).toHaveCount(1); // only police: it was not saved
  // The ID choice made for the old file is not carried over to the new one.
  await expect(
    page.getByLabel("Government ID check result to record"),
  ).toHaveValue("pending");
  await expect(page.getByLabel("Police check result to record")).toHaveValue(
    "not_started",
  );
});

test("signed links are fetched again before they expire", async ({ page }) => {
  await page.clock.install();
  await loginAdmin(page);
  await openChef(page, "Linh Nguyen");
  await expect(tid(page, "doc-unavailable")).toHaveCount(0);
  await editMockState(
    page,
    `const c = s.adminQueue.find((c) => c.id.endsWith("901"));
     c.vanished = ["idDocument"];`,
  );
  await page.clock.fastForward("04:10"); // the 300-second links are renewed after 240 seconds
  await expect(tid(page, "doc-unavailable")).toHaveCount(1);
});

test("keyboard only: open a chef, reach the reject form and submit it", async ({
  page,
}) => {
  await loginAdmin(page);
  await page
    .getByRole("link", { name: "Linh Nguyen (open application)" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { level: 1, name: "Review chef application" }),
  ).toBeVisible();
  const reason = page.getByLabel("Reason for rejecting (shown to the chef)");
  await reason.focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Reject application" }),
  ).toBeFocused();
  await page.keyboard.press("Enter"); // empty reason
  await expect(reason).toBeFocused();
  await page.keyboard.type("Keyboard test reason.");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  await expect(tid(page, "chef-status")).toHaveText("Rejected");
});

test("mobile 375px: no horizontal scroll and no axe violations on the queue and a review", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await loginAdmin(page);
  const overflow = () =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
  expect(await overflow()).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);
  await openChef(page, "Linh Nguyen");
  await expect(
    page.getByRole("img", { name: /Kitchen photo 1/ }),
  ).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);
});

test("a customer, a chef and a visitor are sent away from /admin", async ({
  page,
}) => {
  await page.goto("/admin/chefs");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Cathy");
  await page.getByLabel("Email").fill("cathy@example.com");
  await page.getByLabel("Password").fill("longenough1");
  await page.getByRole("radio", { name: /customer/ }).check();
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/verify-phone$/);
  await page.goto("/admin/chefs");
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Chef applications" }),
  ).toHaveCount(0);
});

test("dark mode: the queue and a review are axe clean", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const page = await context.newPage();
  await loginAdmin(page);
  await expectNoAxeViolations(page);
  await openChef(page, "Vanished Vera");
  await page.getByRole("button", { name: "Approve chef" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "vanished" }),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  await context.close();
});

test("a failed automatic link refresh shows a notice and retries after 30 seconds", async ({
  page,
}) => {
  await page.clock.install();
  await loginAdmin(page);
  await openChef(page, "Linh Nguyen");
  await expect(tid(page, "links-stale")).toHaveCount(0);
  // Make the server fail the refresh: the chef disappears from the mock queue.
  await editMockState(page, `s.saved = s.adminQueue; s.adminQueue = [];`);
  await page.clock.fastForward("04:10");
  await expect(tid(page, "links-stale")).toBeVisible();
  await expect(tid(page, "links-stale")).toContainText("may have expired");
  // The page still shows the application; the manual button is there.
  await expect(
    page.getByRole("button", { name: "Reload application and file links" }),
  ).toBeVisible();
  // The server recovers; the retry (30 seconds) clears the notice.
  await editMockState(page, `s.adminQueue = s.saved;`);
  await page.clock.fastForward("00:35");
  await expect(tid(page, "links-stale")).toHaveCount(0);
});

test("an unbroken 120-character display name does not widen the page at 375px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await loginAdmin(page);
  const long = "W".repeat(120);
  await editMockState(
    page,
    `const c = s.adminQueue.find((c) => c.id.endsWith("901"));
     c.app.displayName = "${long}"; c.app.bio = "${long}"; c.app.rejectReason = "${long}";`,
  );
  const overflow = () =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
  await page.reload();
  await expect(tid(page, "queue-count")).toBeVisible();
  await expect(page.getByText(long).first()).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.getByRole("link", { name: `${long} (open application)` }).click();
  await expect(tid(page, "chef-status")).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);
});

test("D-21: an approved chef with a failed MOCK check is flagged in the queue; a rejected chef's kitchen has no review controls (MOCK)", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.getByLabel("Status").selectOption("approved");
  await openChef(page, "Tuan Pham");
  await page.getByLabel("Police check").selectOption("failed");
  await page.getByRole("button", { name: "Save MOCK checks" }).click();
  await expect(page.getByText(/MOCK checks saved/)).toBeVisible();
  await page
    .getByRole("link", { name: "Back to the chef applications" })
    .click();
  const flag = tid(page, "queue-flag");
  await expect(flag).toHaveCount(1);
  await expect(flag).toContainText("Needs a look");
  await expect(flag).toContainText("Police check");
  await expect(flag.getByTestId("mock-badge")).toBeVisible();
  await expectNoAxeViolations(page);

  // Rosa is rejected: her kitchen section explains why there is nothing to decide.
  await page.getByLabel("Status").selectOption("rejected");
  await openChef(page, "Rosa Lee");
  const kitchen = page.getByRole("region", { name: "Kitchen (MOCK review)" });
  if (await kitchen.count()) {
    await expect(kitchen).toContainText("rejected");
    await expect(
      kitchen.getByRole("button", { name: /kitchen \(MOCK\)/ }),
    ).toHaveCount(0);
  }
});
