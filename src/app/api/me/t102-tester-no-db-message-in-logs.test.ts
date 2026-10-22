// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// T-102 Tester (LOW-6). Private-data routes must never log the database message: a unique
// violation can carry a constraint name and a key value such as a phone or address hash.
// A scripted fake database answers each query in order; one query fails with a code and a
// message full of "secrets"; we spy on every console method and look at every response body.
const SECRET = "Key (phone_hash)=(c0ffee0badc0ffee) already exists SECRETMSG";
type Result = {
  data: unknown;
  error: null | { code: string; message: string };
};
const ok = (data: unknown = null): Result => ({ data, error: null });
const bad = (code = "23505"): Result => ({
  data: null,
  error: { code, message: SECRET },
});

let script: Result[] = [];
let calls: string[] = [];
function fakeDb() {
  const make = (label: string): unknown => {
    const next = () => {
      calls.push(label);
      return script.shift() ?? ok();
    };
    const chain: Record<string, unknown> = {};
    const proxy: unknown = new Proxy(chain, {
      get(_t, prop: string) {
        if (prop === "then") {
          const r = next();
          return (res: (v: Result) => void) => res(r);
        }
        if (prop === "maybeSingle" || prop === "single")
          return async () => next();
        return () => proxy;
      },
    });
    return proxy;
  };
  return { from: (table: string) => make(table) };
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/pepper", () => ({ getHashPepper: () => "p".repeat(40) }));
vi.mock("@/lib/server/mock-sms", () => ({ MOCK_SMS_ENABLED: true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeDb() }));
vi.mock("@/lib/server/caller", () => ({
  requireCaller: async () => ({
    userId: "u1",
    role: "chef",
    supabase: fakeDb(),
  }),
}));
vi.mock("@/lib/server/bookings", () => ({
  requireCustomer: async () => ({ userId: "u1", supabase: fakeDb() }),
}));

import { resetRateLimits } from "@/lib/api/rate-limit";

const req = (url: string, method: string, body?: unknown) =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

let spies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  resetRateLimits();
  calls = [];
  spies = (["error", "warn", "log", "info", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});
afterEach(() => spies.forEach((s) => s.mockRestore()));

function loggedText() {
  return JSON.stringify(spies.flatMap((s) => s.mock.calls));
}

interface Case {
  name: string;
  load: () => Promise<(r: Request) => Promise<Response> | Response>;
  request: () => Request;
  script: Result[];
  label: string; // must appear in the log (proves the route logged and was not skipped)
}
const cases: Case[] = [
  {
    name: "POST /api/me/phone, lookup fails",
    load: async () => (await import("../me/phone/route")).POST,
    request: () =>
      req("http://x/api/me/phone", "POST", { phone: "416-555-0123" }),
    script: [bad("XX000")],
    label: "phone lookup failed (code XX000)",
  },
  {
    name: "POST /api/me/phone, duplicate check fails",
    load: async () => (await import("../me/phone/route")).POST,
    request: () =>
      req("http://x/api/me/phone", "POST", { phone: "416-555-0123" }),
    script: [ok(null), bad("23505")],
    label: "phone check failed (code 23505)",
  },
  {
    name: "POST /api/me/phone, save fails with a unique violation",
    load: async () => (await import("../me/phone/route")).POST,
    request: () =>
      req("http://x/api/me/phone", "POST", { phone: "416-555-0123" }),
    script: [ok(null), ok([]), bad("23505")],
    label: "phone save failed (code 23505)",
  },
  {
    name: "POST /api/me/phone/verify, lookup fails",
    load: async () => (await import("../me/phone/verify/route")).POST,
    request: () =>
      req("http://x/api/me/phone/verify", "POST", { code: "123456" }),
    script: [bad("XX000")],
    label: "phone lookup failed (code XX000)",
  },
  {
    name: "POST /api/me/phone/verify, update fails (not the unique case)",
    load: async () => (await import("../me/phone/verify/route")).POST,
    request: () =>
      req("http://x/api/me/phone/verify", "POST", { code: "123456" }),
    script: [ok({ phone_hash: "h", phone_verified: false }), bad("40001")],
    label: "verify failed (code 40001)",
  },
  {
    name: "PUT /api/me/address, prefix lookup fails",
    load: async () => (await import("../me/address/route")).PUT,
    request: () =>
      req("http://x/api/me/address", "PUT", {
        line: "1 Main St",
        city: "Mississauga",
        postalCode: "L5B 1A1",
      }),
    script: [bad("XX000")],
    label: "prefix lookup failed (code XX000)",
  },
  {
    name: "PUT /api/me/address, save fails with a unique violation",
    load: async () => (await import("../me/address/route")).PUT,
    request: () =>
      req("http://x/api/me/address", "PUT", {
        line: "1 Main St",
        city: "Mississauga",
        postalCode: "L5B 1A1",
      }),
    script: [ok({ prefix: "L5B" }), bad("23505")],
    label: "address save failed (code 23505)",
  },
  {
    name: "GET /api/me/intake fails",
    load: async () => (await import("../me/intake/route")).GET as never,
    request: () => req("http://x/api/me/intake", "GET"),
    script: [bad("XX000")],
    label: "saved intake load failed (code XX000)",
  },
  {
    name: "DELETE /api/me/intake fails",
    load: async () => (await import("../me/intake/route")).DELETE,
    request: () => req("http://x/api/me/intake", "DELETE", {}),
    script: [bad("23505")],
    label: "saved intake clear failed (code 23505)",
  },
  {
    name: "PATCH /api/me, profile update fails",
    load: async () => (await import("../me/route")).PATCH,
    request: () => req("http://x/api/me", "PATCH", { displayName: "Mai" }),
    script: [bad("23505")],
    label: "profile update failed (code 23505)",
  },
  {
    name: "PATCH /api/me, chef name update fails",
    load: async () => (await import("../me/route")).PATCH,
    request: () => req("http://x/api/me", "PATCH", { displayName: "Mai" }),
    script: [ok(), bad("23505")],
    label: "chef name update failed (code 23505)",
  },
  {
    name: "GET /api/me, profile load fails",
    load: async () => (await import("../me/route")).GET as never,
    request: () => req("http://x/api/me", "GET"),
    script: [bad("XX000")],
    label: "profile load failed (code XX000)",
  },
  {
    name: "GET /api/me, private load fails",
    load: async () => (await import("../me/route")).GET as never,
    request: () => req("http://x/api/me", "GET"),
    script: [
      ok({ id: "u1", role: "customer", display_name: "Mai" }),
      bad("XX000"),
    ],
    label: "private load failed (code XX000)",
  },
];

describe("LOW-6: a failing database call in a private-data route logs a fixed label and the code only", () => {
  it.each(cases)("$name", async (c) => {
    script = [...c.script];
    const handler = await c.load();
    const res = await handler(c.request());
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toContain("SECRETMSG");
    expect(body).not.toContain("c0ffee");
    const logged = loggedText();
    expect(logged).toContain(c.label);
    expect(logged).not.toContain("SECRETMSG");
    expect(logged).not.toContain("c0ffee");
    expect(logged).not.toContain("phone_hash");
  });

  it("the verify route still maps the unique violation to PHONE_IN_USE without logging", async () => {
    script = [ok({ phone_hash: "h", phone_verified: false }), bad("23505")];
    const { POST } = await import("../me/phone/verify/route");
    const res = await POST(
      req("http://x/api/me/phone/verify", "POST", { code: "123456" }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("PHONE_IN_USE");
    expect(loggedText()).not.toContain("SECRETMSG");
  });
});
