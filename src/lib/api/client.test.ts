import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiClientError,
  apiFetch,
  formatRetry,
  isMockEnabled,
} from "@/lib/api/client";

function res(status: number, body: unknown, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

const caught = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error("expected rejection");
    },
    (e) => e as ApiClientError,
  );

describe("apiFetch", () => {
  it("always sends Content-Type: application/json, even without a body", async () => {
    const fetchImpl = vi.fn(async () => res(200, { ok: true }));
    await apiFetch("/api/auth/logout", {
      method: "POST",
      fetchImpl,
      mock: false,
    });
    const init = (
      fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    )[1];
    expect(new Headers(init.headers).get("Content-Type")).toBe(
      "application/json",
    );
    expect(init.body).toBeUndefined();
  });

  it("serialises the body and returns the bare success type", async () => {
    const fetchImpl = vi.fn(async () =>
      res(200, { phoneVerified: true, mock: true }),
    );
    const out = await apiFetch("/api/me/phone/verify", {
      method: "POST",
      body: { code: "123456" },
      fetchImpl,
      mock: false,
    });
    expect(out).toEqual({ phoneVerified: true, mock: true });
    expect(
      (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body,
    ).toBe('{"code":"123456"}');
  });

  it("parses field errors", async () => {
    const fetchImpl = async () =>
      res(422, {
        error: {
          code: "VALIDATION_FAILED",
          message: "Check the highlighted fields.",
          fields: { postalCode: "Not a GTA postal code." },
        },
      });
    const err = await caught(apiFetch("/x", { fetchImpl, mock: false }));
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.fields).toEqual({ postalCode: "Not a GTA postal code." });
  });

  it("reads retryAfterSeconds on 429, falling back to the Retry-After header", async () => {
    const a = await caught(
      apiFetch("/x", {
        mock: false,
        fetchImpl: async () =>
          res(429, {
            error: {
              code: "RATE_LIMITED",
              message: "Slow down.",
              retryAfterSeconds: 30,
            },
          }),
      }),
    );
    expect(a.retryAfterSeconds).toBe(30);
    const b = await caught(
      apiFetch("/x", {
        mock: false,
        fetchImpl: async () =>
          res(
            429,
            { error: { code: "RATE_LIMITED", message: "Slow down." } },
            { "Retry-After": "120" },
          ),
      }),
    );
    expect(b.retryAfterSeconds).toBe(120);
  });

  it("gives a generic error for a non-contract body and for network failure", async () => {
    const a = await caught(
      apiFetch("/x", {
        mock: false,
        fetchImpl: async () => new Response("<html>", { status: 502 }),
      }),
    );
    expect(a.code).toBe("UNKNOWN");
    expect(a.message).not.toContain("<html>");
    const b = await caught(
      apiFetch("/x", {
        mock: false,
        fetchImpl: async () => {
          throw new TypeError("fail");
        },
      }),
    );
    expect(b.code).toBe("NETWORK");
  });

  it("uses the mock adapter when mock is on, with contract-shaped results", async () => {
    const fetchImpl = vi.fn();
    const err = await caught(
      apiFetch("/api/auth/login", {
        method: "POST",
        body: { email: "a@b.co", password: "wrongpass" },
        fetchImpl,
        mock: true,
      }),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(err.code).toBe("INVALID_CREDENTIALS");
    expect(err.status).toBe(401);
  });
});

describe("formatRetry", () => {
  it("formats seconds and minutes", () => {
    expect(formatRetry(30)).toBe("30 seconds");
    expect(formatRetry(90)).toBe("2 minutes");
    expect(formatRetry(60)).toBe("1 minute");
  });
});

describe("isMockEnabled", () => {
  const original = process.env.NEXT_PUBLIC_API_MOCK;
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_API_MOCK;
    else process.env.NEXT_PUBLIC_API_MOCK = original;
  });
  it("is off unless the flag is exactly 1", () => {
    delete process.env.NEXT_PUBLIC_API_MOCK;
    expect(isMockEnabled()).toBe(false);
    for (const v of ["", "0", "true", "yes"]) {
      process.env.NEXT_PUBLIC_API_MOCK = v;
      expect(isMockEnabled()).toBe(false);
    }
    process.env.NEXT_PUBLIC_API_MOCK = "1";
    expect(isMockEnabled()).toBe(true);
  });
});
