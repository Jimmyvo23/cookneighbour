import { test as base, expect } from "@playwright/test";
import { createLocalAdmin } from "./helpers/local-admin";

// Runs against the REAL /api routes and a throwaway local Supabase (see playwright.config.ts).
// T-034 reviewer finding 5: the raw HTML of a /chef page for a signed-in admin, plus the admin
// API seen through a real browser session.
const json = { "Content-Type": "application/json" };
const o = () => Math.floor(Math.random() * 254) + 1;
const test = base.extend({
  extraHTTPHeaders: async ({}, provide) => {
    await provide({ "x-forwarded-for": `10.${o()}.${o()}.${o()}` });
  },
});

test("a signed-in admin gets no private /chef HTML, and the admin API answers only the admin", async ({
  page,
  request,
}) => {
  const admin = await createLocalAdmin();
  const login = await page.request.post("/api/auth/login", {
    headers: json,
    data: { email: admin.email, password: admin.password },
  });
  expect(login.status()).toBe(200);
  expect((await login.json()).user.role).toBe("admin");

  // The server guard sends an admin away from every /chef page before any private HTML.
  for (const path of ["/chef/dishes", "/chef/availability", "/chef/apply"]) {
    const body = await (await page.request.get(path)).text();
    expect(body).toMatch(/http-equiv="refresh"[^>]*url=\/"/);
    expect(body).not.toContain("Add a dish");
    expect(body).not.toContain("Save availability");
    expect(body).not.toContain("Chef pages");
  }

  // The admin API works for this session, and its answers are never cached.
  const list = await page.request.get("/api/admin/chefs?status=all&limit=5");
  expect(list.status()).toBe(200);
  expect(list.headers()["cache-control"]).toBe("no-store");
  const body = await list.json();
  expect(Array.isArray(body.items)).toBe(true);
  expect(JSON.stringify(body)).not.toMatch(/hash/i);

  // A visitor without a session is refused.
  const anon = await request.get("/api/admin/chefs");
  expect(anon.status()).toBe(401);
});
