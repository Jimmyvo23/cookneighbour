// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

// T-102 Tester (LOW-7): edges the builder's pepper test does not pin.
vi.mock("server-only", () => ({}));
import { getHashPepper, MIN_PEPPER_LENGTH } from "./pepper";

afterEach(() => vi.unstubAllEnvs());

function message(): string {
  try {
    getHashPepper();
  } catch (e) {
    return String((e as Error).message);
  }
  return "NO THROW";
}

describe("getHashPepper edges", () => {
  it("the limit is 32", () => {
    expect(MIN_PEPPER_LENGTH).toBe(32);
  });

  it.each(["production", "development", "staging", ""])(
    "31 characters throw and 32 pass when NODE_ENV=%j; the value is never in the message",
    (env) => {
      vi.stubEnv("NODE_ENV", env);
      const v31 = "Q".repeat(31);
      vi.stubEnv("HASH_PEPPER", v31);
      const m = message();
      expect(m).toMatch(/at least 32/);
      expect(m).not.toContain(v31);
      expect(m).not.toContain("QQQ");
      const v32 = "Q".repeat(32);
      vi.stubEnv("HASH_PEPPER", v32);
      expect(getHashPepper()).toBe(v32);
    },
  );

  it("an unset NODE_ENV counts as 'not test' (must be strong)", () => {
    vi.stubEnv("NODE_ENV", undefined as unknown as string);
    vi.stubEnv("HASH_PEPPER", "short");
    expect(message()).toMatch(/at least 32/);
  });

  it("whitespace around a 32-character value is trimmed, and only the trimmed length counts", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HASH_PEPPER", `  ${"k".repeat(32)}\n`);
    expect(getHashPepper()).toBe("k".repeat(32));
    vi.stubEnv(
      "HASH_PEPPER",
      `${" ".repeat(10)}${"k".repeat(31)}${" ".repeat(10)}`,
    );
    expect(message()).toMatch(/at least 32/);
  });

  it("a missing pepper message does not mention a value either", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HASH_PEPPER", undefined as unknown as string);
    expect(message()).toMatch(/Missing environment variable HASH_PEPPER/);
  });

  it("under NODE_ENV=test even one character is accepted (documented test-only escape)", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("HASH_PEPPER", "x");
    expect(getHashPepper()).toBe("x");
  });
});

describe("the e2e placeholder pepper in playwright.config.ts passes the 32 character rule", () => {
  it("is at least 32 characters (next start runs with NODE_ENV=production)", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync("playwright.config.ts", "utf8");
    const m = /HASH_PEPPER:\s*"([^"]+)"/.exec(text);
    expect(m, "HASH_PEPPER literal found").not.toBeNull();
    expect(m![1].length).toBeGreaterThanOrEqual(MIN_PEPPER_LENGTH);
  });
});
