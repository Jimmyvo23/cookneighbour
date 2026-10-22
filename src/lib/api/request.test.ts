// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorResponse, ApiFailure, handle } from "./errors";
import {
  clientIp,
  readJsonObject,
  readOptionalJsonObject,
  rejectUnknownKeys,
  requireJson,
} from "./request";

const req = (ct: string | null, body = "{}") =>
  new Request("http://x/api", {
    method: "POST",
    body,
    headers: ct === null ? {} : { "content-type": ct },
  });

describe("requireJson (CSRF rule)", () => {
  it.each([
    "application/json",
    "application/json; charset=utf-8",
    "Application/JSON",
    'application/json; charset="UTF-8"',
  ])("accepts %s", (ct) => expect(() => requireJson(req(ct))).not.toThrow());
  it.each([
    null,
    "text/plain",
    "multipart/form-data; boundary=x",
    "application/x-www-form-urlencoded",
    "application/jsonp",
    "application/json; boundary=x",
    "text/plain; application/json",
  ])("rejects %s", (ct) =>
    expect(() => requireJson(req(ct))).toThrow(ApiFailure),
  );
});

describe("requireJson with a really absent Content-Type header (tester T1)", () => {
  // new Request(url, { body: "<string>" }) adds text/plain itself, so req(null) above still has a
  // header. A bare fetch(url, { method: "POST" }) has no body and no header at all.
  it("a POST with no body and no header has no content-type and is rejected", () => {
    const bare = new Request("http://x/api", { method: "POST" });
    expect(bare.headers.get("content-type")).toBeNull();
    expect(() => requireJson(bare)).toThrow(ApiFailure);
    try {
      requireJson(bare);
    } catch (e) {
      expect((e as ApiFailure).code).toBe("BAD_REQUEST");
    }
  });
  it("the same holds for PATCH and DELETE without a body", () => {
    for (const method of ["PATCH", "DELETE"])
      expect(() =>
        requireJson(new Request("http://x/api", { method })),
      ).toThrow(ApiFailure);
  });
});

describe("readJsonObject", () => {
  it("parses objects and rejects bad JSON, arrays and scalars", async () => {
    expect(await readJsonObject(req("application/json", '{"a":1}'))).toEqual({
      a: 1,
    });
    for (const bad of ["{", "[]", "1", "null", '"x"'])
      await expect(
        readJsonObject(req("application/json", bad)),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("rejectUnknownKeys", () => {
  it("422s every key outside the whitelist", () => {
    expect(() => rejectUnknownKeys({ a: 1 }, ["a"])).not.toThrow();
    try {
      rejectUnknownKeys({ a: 1, role: "admin" }, ["a"]);
      expect.unreachable();
    } catch (e) {
      expect((e as ApiFailure).code).toBe("VALIDATION_FAILED");
      expect((e as ApiFailure).extra.fields).toEqual({
        role: "Unknown field.",
      });
    }
  });
});

describe("error responses", () => {
  it("use the contract shape, status and Retry-After", async () => {
    const res = errorResponse(
      new ApiFailure("RATE_LIMITED", "slow down", { retryAfterSeconds: 7 }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("7");
    expect(await res.json()).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "slow down",
        retryAfterSeconds: 7,
      },
    });
  });
  it("map every code to the documented status", () => {
    const table: Record<string, number> = {
      BAD_REQUEST: 400,
      UNAUTHENTICATED: 401,
      INVALID_CREDENTIALS: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      EMAIL_IN_USE: 409,
      PHONE_IN_USE: 409,
      PHONE_NOT_SUBMITTED: 409,
      PHONE_NOT_VERIFIED: 409,
      INVALID_STATE: 409,
      APPLICATION_INCOMPLETE: 409,
      VALIDATION_FAILED: 422,
      RATE_LIMITED: 429,
      INTERNAL: 500,
    };
    for (const [code, status] of Object.entries(table))
      expect(new ApiFailure(code as never, "m").status).toBe(status);
  });
  it("unexpected errors become a generic 500 with no details", async () => {
    const res = await handle(async () => {
      throw new Error("secret connection string postgres://u:p@host");
    });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("postgres");
    expect(JSON.parse(text).error.code).toBe("INTERNAL");
  });
});

describe("clientIp", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off Vercel (local, CI, tests) uses the first forwarded address", () => {
    vi.stubEnv("VERCEL", "");
    const r = new Request("http://x", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(clientIp(r)).toBe("1.2.3.4");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });

  it("on Vercel trusts only the platform header, never a client-sent x-forwarded-for (T-102, LOW-4)", () => {
    vi.stubEnv("VERCEL", "1");
    const spoof = new Request("http://x", {
      headers: {
        "x-forwarded-for": "6.6.6.6",
        "x-vercel-forwarded-for": "9.9.9.9",
      },
    });
    expect(clientIp(spoof)).toBe("9.9.9.9");
    const onlySpoof = new Request("http://x", {
      headers: { "x-forwarded-for": "6.6.6.6" },
    });
    expect(clientIp(onlySpoof)).toBe("unknown");
    const real = new Request("http://x", {
      headers: { "x-real-ip": "8.8.8.8", "x-forwarded-for": "6.6.6.6" },
    });
    expect(clientIp(real)).toBe("8.8.8.8");
  });
});

describe("readOptionalJsonObject (cancel has an optional body)", () => {
  it("an empty or blank body is {}", async () => {
    expect(await readOptionalJsonObject(req("application/json", ""))).toEqual(
      {},
    );
    expect(
      await readOptionalJsonObject(req("application/json", "  \n")),
    ).toEqual({});
  });
  it("a JSON object is returned", async () => {
    expect(
      await readOptionalJsonObject(req("application/json", '{"reason":"x"}')),
    ).toEqual({ reason: "x" });
  });
  it("still needs the JSON content type, even with an empty body", async () => {
    await expect(readOptionalJsonObject(req("text/plain", ""))).rejects.toThrow(
      ApiFailure,
    );
  });
  it.each(["[1]", "null", "5", '"x"', "{bad"])(
    "rejects %s with 400",
    async (b) => {
      await expect(
        readOptionalJsonObject(req("application/json", b)),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    },
  );
});

describe("dbFailure (T-102, LOW-6)", () => {
  it("keeps the label and the code, never the database message", async () => {
    const { dbFailure } = await import("./errors");
    const e = dbFailure("phone save failed", {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "x" Key (phone_hash)=(deadbeef) already exists.',
    } as { code: string });
    expect(e.message).toBe("phone save failed (code 23505)");
    expect(dbFailure("x failed", null).message).toBe("x failed (code none)");
    expect(dbFailure("x failed", {}).message).toBe("x failed (code none)");
  });

  it("a private-data route logs the code and label, not the database message", async () => {
    const secret = "Key (phone_hash)=(deadbeef00) already exists";
    vi.resetModules();
    vi.doMock("@/lib/server/caller", () => ({
      requireCaller: async () => ({ userId: "u1" }),
    }));
    vi.doMock("@/lib/server/pepper", () => ({ getHashPepper: () => "p" }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: null,
                error: { code: "XX000", message: secret },
              }),
            }),
          }),
        }),
      }),
    }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("@/app/api/me/phone/route");
    const res = await POST(
      new Request("http://x/api/me/phone", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: "416-555-0123" }),
      }),
    );
    expect(res.status).toBe(500);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain("phone lookup failed (code XX000)");
    expect(logged).not.toContain("deadbeef");
    log.mockRestore();
    vi.doUnmock("@/lib/server/caller");
    vi.doUnmock("@/lib/server/pepper");
    vi.doUnmock("@/lib/supabase/admin");
  });
});
