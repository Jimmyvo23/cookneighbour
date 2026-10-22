import { expect, test, type Page } from "@playwright/test";
import { blockStorage, loginAdmin, signUpChef } from "./helpers";

// T-100 Tester: broad walk through the mock pages with a CSP console listener, a framing
// check, and header checks on API routes, 404s and static assets.

function watchCsp(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (/content security policy|violates the following/i.test(m.text()))
      problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(e.message));
  return problems;
}

test("no CSP violation across home, auth, chef apply and admin pages", async ({
  page,
}) => {
  await blockStorage(page);
  await page.route("https://tile.openstreetmap.org/**", (r) => r.abort());
  const problems = watchCsp(page);
  for (const path of ["/", "/search", "/login", "/signup"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  await signUpChef(page, "Csp Chef");
  await page.waitForLoadState("networkidle");
  // A fresh browser context (new session) for the admin pages.
  const admin = await page.context().browser()!.newContext();
  const adminPage = await admin.newPage();
  await blockStorage(adminPage);
  const adminProblems = watchCsp(adminPage);
  await loginAdmin(adminPage);
  await adminPage.waitForLoadState("networkidle");
  problems.push(...adminProblems);
  await admin.close();
  await page.waitForLoadState("networkidle");
  expect(problems).toEqual([]);
});

test("a hostile page cannot frame the app", async ({ page, baseURL }) => {
  // Positive controls so the test cannot pass vacuously: (1) /login really shows the Email
  // field when opened top level (also warms the dev compile); (2) a frameable control iframe
  // on the same hostile page does load, so the page, iframes and our wait all work.
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible();

  await page.route("http://evil.test/**", (r) =>
    r.request().url().endsWith("/control")
      ? r.fulfill({ contentType: "text/html", body: "<p>control-ok</p>" })
      : r.fulfill({
          contentType: "text/html",
          body: `<iframe id="ctl" src="http://evil.test/control"></iframe>
<iframe id="f" src="${baseURL}/login"></iframe>`,
        }),
  );
  await page.goto("http://evil.test/");
  await expect(page.locator("iframe")).toHaveCount(2);
  await expect(page.frameLocator("#ctl").getByText("control-ok")).toBeVisible();
  // Wait until the target frame has navigated away from about:blank, then check it.
  await expect
    .poll(
      () =>
        page
          .frames()
          .find(
            (f) =>
              f.name() === "" &&
              f !== page.mainFrame() &&
              !f.url().startsWith("http://evil.test/control") &&
              f.url() !== "about:blank",
          )
          ?.url() ?? "",
      { timeout: 10_000 },
    )
    .not.toBe("");
  const framed = page.frames().find((f) => f.url().startsWith(baseURL!));
  // Blocked frames never reach a loaded app page.
  const hasForm = framed ? await framed.getByLabel("Email").count() : 0;
  expect(hasForm).toBe(0);
});

test("API routes, 404s and static assets carry the headers", async ({
  request,
  page,
}) => {
  const html = await (await request.get("/search")).text();
  const asset = html.match(/\/_next\/static\/[^"]+\.(?:js|css)/)?.[0];
  expect(asset).toBeTruthy();
  for (const url of ["/api/me", "/api/does-not-exist", "/nope", asset!]) {
    const h = (await request.get(url)).headers();
    expect(h["content-security-policy"], url).toContain(
      "frame-ancestors 'none'",
    );
    expect(h["x-frame-options"], url).toBe("DENY");
    expect(h["x-content-type-options"], url).toBe("nosniff");
    expect(h["x-powered-by"], url).toBeUndefined();
  }
  void page;
});
