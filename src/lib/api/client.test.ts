import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiClientError,
  apiFetch,
  API_TIMEOUT_MS,
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

describe("apiFetch timeout (T-075)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const hang = () => new Promise<Response>(() => {});

  it("exports a default of 15 to 20 seconds", () => {
    expect(API_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000);
    expect(API_TIMEOUT_MS).toBeLessThanOrEqual(20_000);
  });

  it("a GET that never answers fails with TIMEOUT and a plain retry message", async () => {
    vi.useFakeTimers();
    const p = caught(apiFetch("/x", { mock: false, fetchImpl: hang }));
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
    const e = await p;
    expect(e.code).toBe("TIMEOUT");
    expect(e.status).toBe(0);
    expect(e.message).toMatch(/took too long/i);
    expect(e.message).not.toMatch(/may or may not/i);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"] as const)(
    "a %s timeout says it may or may not have gone through",
    async (method) => {
      vi.useFakeTimers();
      const p = caught(
        apiFetch("/x", { method, mock: false, fetchImpl: hang }),
      );
      await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
      const e = await p;
      expect(e.code).toBe("TIMEOUT");
      expect(e.message).toMatch(/may or may not/i);
      expect(e.message).toMatch(/check/i);
      expect(e.message).not.toMatch(/nothing was saved|not saved/i);
    },
  );

  it("passes an abort signal that fires at the timeout", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const fetchImpl = vi.fn((_u: unknown, init?: RequestInit) => {
      signal = init?.signal;
      return hang();
    }) as unknown as typeof fetch;
    const p = caught(apiFetch("/x", { mock: false, fetchImpl }));
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
    await p;
    expect(signal?.aborted).toBe(true);
  });

  it("a hung response body also times out", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: () => new Promise(() => {}),
        }) as unknown as Response,
    );
    const p = caught(apiFetch("/x", { mock: false, fetchImpl }));
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
    expect((await p).code).toBe("TIMEOUT");
  });

  it("the mock path times out too", async () => {
    vi.useFakeTimers();
    vi.doMock("@/lib/mocks/mock-adapter", () => ({ mockFetch: hang }));
    const p = caught(apiFetch("/x", { mock: true }));
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
    expect((await p).code).toBe("TIMEOUT");
    vi.doUnmock("@/lib/mocks/mock-adapter");
  });

  it("clears the timer after success and after a network error", async () => {
    vi.useFakeTimers();
    await apiFetch("/x", { mock: false, fetchImpl: async () => res(200, {}) });
    expect(vi.getTimerCount()).toBe(0);
    await caught(
      apiFetch("/x", {
        mock: false,
        fetchImpl: async () => {
          throw new TypeError("fail");
        },
      }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a fast answer is not turned into a timeout later", async () => {
    vi.useFakeTimers();
    const out = await apiFetch<{ a: number }>("/x", {
      mock: false,
      fetchImpl: async () => res(200, { a: 1 }),
    });
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS * 2);
    expect(out).toEqual({ a: 1 });
  });
  it("a real-style fetch that rejects with AbortError on abort still reports TIMEOUT, not NETWORK", async () => {
    vi.useFakeTimers();
    const fetchImpl = ((_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      })) as unknown as typeof fetch;
    const p = caught(apiFetch("/x", { mock: false, fetchImpl }));
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
    expect((await p).code).toBe("TIMEOUT");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not time out just before the limit", async () => {
    vi.useFakeTimers();
    let settled = false;
    const p = caught(apiFetch("/x", { mock: false, fetchImpl: hang })).then(
      (e) => {
        settled = true;
        return e;
      },
    );
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await p).code).toBe("TIMEOUT");
  });

  it("a late answer after the timeout raises no unhandled rejection", async () => {
    vi.useFakeTimers();
    const unhandled: unknown[] = [];
    const on = (r: unknown) => unhandled.push(r);
    process.on("unhandledRejection", on);
    try {
      let late!: (r: Response) => void;
      let lateFail!: (e: unknown) => void;
      const first = new Promise<Response>((r) => (late = r));
      const second = new Promise<Response>((_, r) => (lateFail = r));
      const p1 = caught(
        apiFetch("/x", { mock: false, fetchImpl: () => first }),
      );
      const p2 = caught(
        apiFetch("/x", { mock: false, fetchImpl: () => second }),
      );
      await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
      expect((await p1).code).toBe("TIMEOUT");
      expect((await p2).code).toBe("TIMEOUT");
      late(res(200, { a: 1 }));
      lateFail(new TypeError("late network failure"));
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", on);
    }
  });

  it("clears the timer when the server answers with an error status", async () => {
    vi.useFakeTimers();
    const e = await caught(
      apiFetch("/x", {
        mock: false,
        fetchImpl: async () =>
          res(500, { error: { code: "INTERNAL", message: "boom" } }),
      }),
    );
    expect(e.status).toBe(500);
    expect(vi.getTimerCount()).toBe(0);
    await caught(
      apiFetch("/x", { mock: false, fetchImpl: async () => res(502, "bad") }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
