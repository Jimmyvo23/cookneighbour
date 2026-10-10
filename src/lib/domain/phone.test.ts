import { describe, expect, it } from "vitest";
import { maskPhone, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it.each([
    ["+14165550101", "+14165550101"],
    ["416-555-0101", "+14165550101"],
    ["(416) 555 0101", "+14165550101"],
    ["1 416 555 0101", "+14165550101"],
    ["416.555.0101", "+14165550101"],
    ["  +1 (905) 555-0199 ", "+19055550199"],
  ])("accepts %s", (input, out) => {
    expect(normalizePhone(input)).toBe(out);
  });
  it.each([
    "",
    "abc",
    "555-0101",
    "416555010",
    "41655501011",
    "+44 20 7946 0958",
    "+4165550101",
    "016-555-0101",
    "416-055-0101",
    "416-555-0101 ext 5",
    "416555010x",
    "1-1-416-555-0101",
    "911-555-0101", // N11 area code
    "416-411-0101", // N11 exchange
    "211 311 0101",
    "100-555-0101",
  ])("rejects %j", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
  it("rejects non-strings", () => {
    expect(normalizePhone(undefined as unknown as string)).toBeNull();
    expect(normalizePhone(4165550101 as unknown as string)).toBeNull();
  });
});

describe("maskPhone", () => {
  it("shows only the last four digits", () => {
    expect(maskPhone("+14165550101")).toBe("+1******0101");
  });
});
