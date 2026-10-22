// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Supabase Auth itself rate limits sign-ins. That must surface as RATE_LIMITED, not as a
// wrong-password 401, and a Supabase outage must stay a generic 500.
const signIn = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithPassword: signIn } }),
}));
vi.mock("@/lib/server/me", () => ({ loadProfile: async () => ({ id: "u" }) }));

import { resetRateLimits } from "@/lib/api/rate-limit";
import { POST } from "./route";

const call = () =>
  POST(
    new Request("http://x/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@example.com", password: "pw-pw-pw-1" }),
    }),
  );

beforeEach(() => {
  resetRateLimits();
  signIn.mockReset();
});

describe("POST /api/auth/login Supabase error mapping", () => {
  it("maps Supabase auth 429 to RATE_LIMITED", async () => {
    signIn.mockResolvedValue({
      data: {},
      error: { status: 429, code: "over_request_rate_limit" },
    });
    const res = await call();
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
    expect(res.headers.get("retry-after")).toBe("60");
  });
  it("keeps wrong credentials as 401 INVALID_CREDENTIALS", async () => {
    signIn.mockResolvedValue({
      data: {},
      error: { status: 400, code: "invalid_credentials" },
    });
    const res = await call();
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("INVALID_CREDENTIALS");
  });
  it("keeps a Supabase 5xx as a generic 500", async () => {
    signIn.mockResolvedValue({
      data: {},
      error: { status: 502, code: "unexpected_failure" },
    });
    expect((await call()).status).toBe(500);
  });
});

describe("POST /api/auth/login rate limit keys (T-102, LOW-4)", () => {
  const callFrom = (ip: string, email: string) =>
    POST(
      new Request("http://x/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ email, password: "pw-pw-pw-1" }),
      }),
    );

  it("a new IP per request does not reset the limit for one email", async () => {
    signIn.mockResolvedValue({
      data: {},
      error: { status: 400, code: "invalid_credentials" },
    });
    for (let i = 0; i < 20; i++)
      expect((await callFrom(`10.0.0.${i}`, "victim@example.com")).status).toBe(
        401,
      );
    const res = await callFrom("10.0.1.1", "victim@example.com");
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
    // another email from a fresh IP is still allowed
    expect((await callFrom("10.0.1.2", "other@example.com")).status).toBe(401);
  });
});
