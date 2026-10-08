import { describe, expect, it } from "vitest";
import {
  addressKey,
  normalizeAddressLine,
  normalizePostalCode,
  postalPrefix,
} from "./address";

describe("normalizeAddressLine (A-2)", () => {
  it("lowercases, trims, collapses spaces", () => {
    expect(normalizeAddressLine("  100   FICTIONAL  Way ")).toBe(
      "100 fictional way",
    );
  });
  it("strips punctuation", () => {
    expect(normalizeAddressLine("100 Fictional St., Unit #5")).toBe(
      "100 fictional st unit 5",
    );
  });
  it("maps street words to standard abbreviations", () => {
    expect(normalizeAddressLine("12 Main Street North")).toBe("12 main st n");
    expect(normalizeAddressLine("12 Main St N")).toBe("12 main st n");
    expect(normalizeAddressLine("7 Oak Avenue")).toBe(
      normalizeAddressLine("7 oak ave."),
    );
    expect(normalizeAddressLine("3 Pine Crescent")).toBe("3 pine cres");
  });
  it("keeps the unit number so different units differ", () => {
    expect(normalizeAddressLine("5-100 Main St")).not.toBe(
      normalizeAddressLine("6-100 Main St"),
    );
    expect(normalizeAddressLine("Apt 5, 100 Main St")).toBe(
      "unit 5 100 main st",
    );
    expect(normalizeAddressLine("#5 100 Main St")).toBe("unit 5 100 main st");
  });
});

describe("postal codes", () => {
  it("normalizes case and spacing, rejects bad shapes", () => {
    expect(normalizePostalCode("l5b 1a1")).toBe("L5B1A1");
    expect(normalizePostalCode("L5B-1A1")).toBe("L5B1A1");
    expect(normalizePostalCode("12345")).toBeNull();
    expect(normalizePostalCode("L5B1A")).toBeNull();
    expect(normalizePostalCode("")).toBeNull();
  });
  it("prefix is the first three characters", () => {
    expect(postalPrefix("L5B1A1")).toBe("L5B");
  });
  it("addressKey treats equivalent spellings the same", () => {
    expect(addressKey("100 Fictional Street", "l5b 1a1")).toBe(
      addressKey("100 fictional st.", "L5B1A1"),
    );
    expect(() => addressKey("x", "bad")).toThrow();
  });
});
