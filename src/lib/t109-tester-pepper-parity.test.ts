// T-109 (Tester): the seed and the app hash with exactly the same pepper, and the shared rule
// keeps the 31/32 boundary and never echoes the value.
import { describe, expect, it } from "vitest";
import { checkPepper, MIN_PEPPER_LENGTH } from "./domain/pepper-rule";
import { phoneHash } from "./domain/hash";
import { phoneColumns } from "./domain/private-rows";

describe("T-109 tester: seed/app pepper parity", () => {
  it("a padded pepper seeds the same phone hash the app computes from the trimmed value", () => {
    const core = "k".repeat(MIN_PEPPER_LENGTH);
    const check = checkPepper(`\t ${core}\n`);
    if (!check.ok) throw new Error("expected ok");
    const seeded = phoneColumns("+14165550101", check.pepper);
    expect(seeded.phone_hash).toBe(phoneHash("4165550101", core));
  });

  it("boundary 31 refused, 32 ok; message has no value", () => {
    const v31 = "q".repeat(MIN_PEPPER_LENGTH - 1);
    const r = checkPepper(v31);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).not.toContain(v31);
    expect(checkPepper("q".repeat(MIN_PEPPER_LENGTH)).ok).toBe(true);
  });
});
