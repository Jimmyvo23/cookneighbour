// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// T-102 Tester (LOW-4). On Vercel only the platform headers name the client; a client-sent
// x-forwarded-for must not pick the rate-limit bucket. The email-only keys do not depend on the
// IP, and the email is normalised (case, surrounding whitespace) before it is keyed.
const signIn = vi.fn();
const signUp = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: signIn,
      getUser: async () => ({ data: { user: null } }),
      signUp,
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/server/me", () => ({ loadProfile: async () => ({ id: "u" }) }));

import { resetRateLimits } from "@/lib/api/rate-limit";
import { POST as login } from "./login/route";
import { POST as signup } from "./signup/route";

const post = (
  fn: (r: Request) => Promise<Response> | Response,
  path: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
) =>
  fn(
    new Request(`http://x${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
const doLogin = (headers: Record<string, string>, email = "a@example.com") =>
  post(login, "/api/auth/login", headers, { email, password: "pw-pw-pw-1" });
const doSignup = (headers: Record<string, string>, email = "n@example.com") =>
  post(signup, "/api/auth/signup", headers, {
    email,
    password: "pw-pw-pw-1",
    role: "customer",
    displayName: "Mai Tran",
  });

beforeEach(() => {
  resetRateLimits();
  signIn.mockReset();
  signIn.mockResolvedValue({
    data: {},
    error: { status: 400, code: "invalid_credentials" },
  });
  signUp.mockReset();
  signUp.mockResolvedValue({
    data: { user: { id: "u", identities: [{}] }, session: null },
    error: null,
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("LOW-4: on Vercel the client-sent x-forwarded-for does not choose the bucket", () => {
  beforeEach(() => vi.stubEnv("VERCEL", "1"));

  it("login: one real IP, a new spoofed x-forwarded-for each time, is stopped after 10 tries per IP and email", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await doLogin({
        "x-vercel-forwarded-for": "9.9.9.9",
        "x-forwarded-for": `6.6.6.${i}`,
      });
      expect(res.status).toBe(401);
    }
    const res = await doLogin({
      "x-vercel-forwarded-for": "9.9.9.9",
      "x-forwarded-for": "6.6.7.7",
    });
    expect(res.status).toBe(429);
    // a different real IP has its own allowance
    const other = await doLogin({ "x-vercel-forwarded-for": "9.9.9.10" });
    expect(other.status).toBe(401);
  });

  it("login: x-real-ip is the fallback and x-forwarded-for alone is ignored (shared 'unknown' bucket)", async () => {
    for (let i = 0; i < 10; i++)
      expect((await doLogin({ "x-forwarded-for": `6.6.6.${i}` })).status).toBe(
        401,
      );
    expect((await doLogin({ "x-forwarded-for": "6.6.9.9" })).status).toBe(429);
    resetRateLimits();
    for (let i = 0; i < 10; i++)
      expect(
        (
          await doLogin({
            "x-real-ip": "8.8.8.8",
            "x-forwarded-for": `6.6.6.${i}`,
          })
        ).status,
      ).toBe(401);
    expect(
      (await doLogin({ "x-real-ip": "8.8.8.8", "x-forwarded-for": "6.6.9.9" }))
        .status,
    ).toBe(429);
  });

  it("sign-up: spoofed x-forwarded-for does not reset the per-IP limit of 10 per hour", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await doSignup(
        {
          "x-vercel-forwarded-for": "9.9.9.9",
          "x-forwarded-for": `6.6.6.${i}`,
        },
        `n${i}@example.com`,
      );
      expect(res.status).toBe(201);
    }
    const res = await doSignup(
      { "x-vercel-forwarded-for": "9.9.9.9", "x-forwarded-for": "6.6.7.7" },
      "n99@example.com",
    );
    expect(res.status).toBe(429);
  });
});

describe("LOW-4: email-only keys (any environment)", () => {
  it("login: 20 attempts per email in total across IPs, then 429; case and spaces do not make a new key", async () => {
    const variants = [
      "Victim@Example.com",
      "  victim@example.com ",
      "VICTIM@EXAMPLE.COM",
      "victim@example.com",
    ];
    for (let i = 0; i < 20; i++) {
      const res = await doLogin(
        { "x-forwarded-for": `10.0.${Math.floor(i / 200)}.${i}` },
        variants[i % variants.length],
      );
      expect(res.status, `attempt ${i + 1}`).toBe(401);
    }
    for (const v of variants) {
      const res = await doLogin({ "x-forwarded-for": "10.9.9.9" }, v);
      expect(res.status, v).toBe(429);
    }
    expect(signIn).toHaveBeenCalledTimes(20);
    expect(
      (
        await doLogin(
          { "x-forwarded-for": "10.9.9.9" },
          "someone-else@example.com",
        )
      ).status,
    ).toBe(401);
  });

  it("login: a refused (429) call never reaches Supabase Auth", async () => {
    for (let i = 0; i < 20; i++)
      await doLogin({ "x-forwarded-for": `10.1.0.${i}` });
    signIn.mockClear();
    expect((await doLogin({ "x-forwarded-for": "10.1.9.9" })).status).toBe(429);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("sign-up: 10 per hour per email across IPs, case and spaces normalised; refused calls never reach Auth", async () => {
    const variants = [
      "New@Example.com",
      " new@example.com ",
      "NEW@EXAMPLE.COM",
    ];
    for (let i = 0; i < 10; i++)
      expect(
        (await doSignup({ "x-forwarded-for": `10.2.0.${i}` }, variants[i % 3]))
          .status,
      ).toBe(201);
    signUp.mockClear();
    for (const v of variants)
      expect(
        (await doSignup({ "x-forwarded-for": "10.2.9.9" }, v)).status,
        v,
      ).toBe(429);
    expect(signUp).not.toHaveBeenCalled();
  });

  it("an invalid request does not use up the email allowance", async () => {
    for (let i = 0; i < 15; i++) {
      const res = await post(
        signup,
        "/api/auth/signup",
        { "x-forwarded-for": `10.3.0.${i}` },
        {
          email: "bad@example.com",
          password: "short",
          role: "customer",
          displayName: "Mai",
        },
      );
      expect(res.status).toBe(422);
    }
    expect(
      (await doSignup({ "x-forwarded-for": "10.3.9.9" }, "bad@example.com"))
        .status,
    ).toBe(201);
  });
});

describe("LOW-6: sign-up chef rows failing log no database message", () => {
  it("logs only the label and code", async () => {
    vi.resetModules();
    const SECRET = "Key (chef_id)=(deadbeef) SECRETMSG";
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          upsert: async () => ({ error: { code: "23505", message: SECRET } }),
        }),
      }),
    }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("./signup/route");
    const res = await post(
      POST,
      "/api/auth/signup",
      {},
      {
        email: "chef@example.com",
        password: "pw-pw-pw-1",
        role: "chef",
        displayName: "Mai Tran",
      },
    );
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("SECRETMSG");
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain("chef rows failed (code 23505)");
    expect(logged).not.toContain("SECRETMSG");
    log.mockRestore();
    vi.doUnmock("@/lib/supabase/admin");
  });
});
