// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { getHashPepper, MIN_PEPPER_LENGTH } from "./pepper";

afterEach(() => vi.unstubAllEnvs());

describe("getHashPepper (T-102, LOW-7)", () => {
  it("refuses a missing, blank or short pepper outside tests", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HASH_PEPPER", "");
    expect(() => getHashPepper()).toThrow(/HASH_PEPPER/);
    vi.stubEnv("HASH_PEPPER", "x".repeat(MIN_PEPPER_LENGTH - 1));
    expect(() => getHashPepper()).toThrow(/at least 32/);
    vi.stubEnv("HASH_PEPPER", `  ${"x".repeat(MIN_PEPPER_LENGTH - 1)}  `);
    expect(() => getHashPepper()).toThrow(/at least 32/);
  });

  it("never puts the value in the error", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("HASH_PEPPER", "short-secret-value");
    try {
      getHashPepper();
      expect.unreachable();
    } catch (e) {
      expect(String(e)).not.toContain("short-secret-value");
    }
  });

  it("accepts 32 characters or more", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HASH_PEPPER", "y".repeat(MIN_PEPPER_LENGTH));
    expect(getHashPepper()).toBe("y".repeat(MIN_PEPPER_LENGTH));
  });

  it("allows a short pepper under test (NODE_ENV=test) only", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("HASH_PEPPER", "api-test-pepper");
    expect(getHashPepper()).toBe("api-test-pepper");
    vi.stubEnv("HASH_PEPPER", "");
    expect(() => getHashPepper()).toThrow(/HASH_PEPPER/);
  });
});
