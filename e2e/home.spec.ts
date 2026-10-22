import { expect, test } from "@playwright/test";

test("home page shows the prototype heading", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("CookNeighbour — prototype");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "CookNeighbour — prototype",
  );
});

// T-100: the real-stack run also checks the headers, with the local Supabase URL in connect-src
// (the live chat step in booking-real.spec.ts proves Realtime is not blocked).
test("pages carry the security headers", async ({ request }) => {
  const res = await request.get("/");
  const h = res.headers();
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-powered-by"]).toBeUndefined();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  if (process.env.API_URL)
    expect(h["content-security-policy"]).toContain(
      new URL(process.env.API_URL).host,
    );
});
