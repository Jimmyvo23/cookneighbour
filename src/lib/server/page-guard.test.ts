import { describe, expect, it } from "vitest";
// Stub: page-guard imports server-only code. Only the pure decision is tested here; the guard
// itself is covered by the real-route Playwright test (visitors and customers are redirected).
import { vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/lib/server/caller", () => ({ requireCaller: vi.fn() }));

import { adminPageRedirect, chefPageRedirect } from "@/lib/server/page-guard";

describe("chefPageRedirect", () => {
  it("signed out goes to /login", () =>
    expect(chefPageRedirect(null)).toBe("/login"));
  it("customer and admin go home", () => {
    expect(chefPageRedirect({ role: "customer" })).toBe("/");
    expect(chefPageRedirect({ role: "admin" })).toBe("/");
  });
  it("chef stays", () => expect(chefPageRedirect({ role: "chef" })).toBeNull());
});

describe("adminPageRedirect", () => {
  it("signed out goes to /login", () =>
    expect(adminPageRedirect(null)).toBe("/login"));
  it("customer and chef go home", () => {
    expect(adminPageRedirect({ role: "customer" })).toBe("/");
    expect(adminPageRedirect({ role: "chef" })).toBe("/");
  });
  it("admin stays", () =>
    expect(adminPageRedirect({ role: "admin" })).toBeNull());
  it("an unknown role is treated as not an admin (fails closed)", () =>
    expect(adminPageRedirect({ role: "superuser" })).toBe("/"));
});
