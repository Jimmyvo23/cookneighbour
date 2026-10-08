// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { ApiFailure } from "./errors";
import { limiterKey, rateLimit, resetRateLimits } from "./rate-limit";

beforeEach(() => resetRateLimits());

describe("rateLimit (in-memory placeholder)", () => {
  it("allows `limit` calls then throws RATE_LIMITED with retryAfterSeconds", () => {
    for (let i = 0; i < 3; i++) rateLimit("k", 3, 60, 1000);
    try {
      rateLimit("k", 3, 60, 1000);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiFailure);
      const f = e as ApiFailure;
      expect(f.code).toBe("RATE_LIMITED");
      expect(f.status).toBe(429);
      expect(f.extra.retryAfterSeconds).toBe(60);
    }
  });
  it("counts keys separately and resets after the window", () => {
    for (let i = 0; i < 3; i++) rateLimit("a", 3, 60, 0);
    expect(() => rateLimit("b", 3, 60, 0)).not.toThrow();
    expect(() => rateLimit("a", 3, 60, 59_000)).toThrow();
    expect(() => rateLimit("a", 3, 60, 61_000)).not.toThrow();
  });
  it("keys are hashed, so raw ids never sit in the map key", () => {
    expect(limiterKey("login", "1.2.3.4", "a@b.co")).toMatch(/^[0-9a-f]{64}$/);
  });
});
