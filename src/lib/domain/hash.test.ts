import { describe, expect, it } from "vitest";
import { addressHash, phoneHash } from "./hash";

describe("hashes", () => {
  it("depend on the pepper and are hex SHA-256 sized", () => {
    expect(phoneHash("+14165550101", "p1")).toMatch(/^[0-9a-f]{64}$/);
    expect(phoneHash("+14165550101", "p1")).not.toBe(
      phoneHash("+14165550101", "p2"),
    );
    expect(addressHash("1 Main St", "L5B1A1", "p1")).not.toBe(
      addressHash("1 Main St", "L5B1A1", "p2"),
    );
  });
  it("normalize before hashing", () => {
    expect(phoneHash("(416) 555-0101", "p")).toBe(
      phoneHash("+14165550101", "p"),
    );
    expect(addressHash("100 Fictional Street", "l5b 1a1", "p")).toBe(
      addressHash("100 fictional st.", "L5B1A1", "p"),
    );
  });
  it("invalid input or an empty pepper throws", () => {
    expect(() => phoneHash("nope", "p")).toThrow();
    expect(() => addressHash("x", "nope", "p")).toThrow();
    expect(() => phoneHash("+14165550101", "")).toThrow();
  });
});
