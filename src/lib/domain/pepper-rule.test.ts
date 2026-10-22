import { describe, expect, it } from "vitest";
import { MIN_PEPPER_LENGTH, checkPepper } from "./pepper-rule";

describe("checkPepper (T-109, shared by the app and scripts/seed.ts)", () => {
  it("uses 32 as the minimum", () => expect(MIN_PEPPER_LENGTH).toBe(32));

  it("refuses 31 characters", () => {
    const r = checkPepper("x".repeat(31));
    expect(r.ok).toBe(false);
  });

  it("accepts 32 characters and returns the value", () => {
    expect(checkPepper("y".repeat(32))).toEqual({
      ok: true,
      pepper: "y".repeat(32),
    });
  });

  it("trims whitespace before counting and before returning", () => {
    expect(checkPepper(`  ${"z".repeat(32)}\n`)).toEqual({
      ok: true,
      pepper: "z".repeat(32),
    });
    expect(checkPepper(` ${"z".repeat(31)} `).ok).toBe(false);
  });

  it("refuses missing, empty and blank values", () => {
    for (const v of [undefined, "", "   "])
      expect(checkPepper(v).ok).toBe(false);
  });

  it("never puts the value in the message", () => {
    const secret = "secret-short-pepper-value";
    const r = checkPepper(secret);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).not.toContain(secret);
      expect(r.message).toMatch(/32/);
    }
  });
});
