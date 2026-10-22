// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const signUp = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: null } }),
      signUp,
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/server/me", () => ({ loadProfile: async () => ({ id: "u" }) }));

import { resetRateLimits } from "@/lib/api/rate-limit";
import { POST } from "./route";

const call = (over: Record<string, unknown>, ip = "10.1.0.1") =>
  POST(
    new Request("http://x/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({
        email: "new@example.com",
        password: "pw-pw-pw-1",
        role: "customer",
        displayName: "Mai Tran",
        ...over,
      }),
    }),
  );

beforeEach(() => {
  resetRateLimits();
  signUp.mockReset();
  signUp.mockResolvedValue({
    data: { user: { id: "u", identities: [{}] }, session: null },
    error: null,
  });
});

describe("POST /api/auth/signup (T-102)", () => {
  it("refuses contact details in the display name, like the database trigger (LOW-3)", async () => {
    for (const displayName of [
      "Call 416 555 0199",
      "mai@example.com",
      "www.mai.ca",
    ]) {
      const res = await call({ displayName });
      expect(res.status, displayName).toBe(422);
      const body = await res.json();
      expect(Object.keys(body.error.fields)).toEqual(["displayName"]);
    }
    expect(signUp).not.toHaveBeenCalled();
  });

  it("limits sign-ups per email even when the IP changes (LOW-4)", async () => {
    for (let i = 0; i < 10; i++)
      expect((await call({}, `10.2.0.${i}`)).status).toBe(201);
    const res = await call({}, "10.2.1.1");
    expect(res.status).toBe(429);
    expect((await call({ email: "x2@example.com" }, "10.2.1.2")).status).toBe(
      201,
    );
  });
});
