// T-111 tester: the shared local pepper must never reach the --hosted seed path.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOCAL_TEST_PEPPER } from "./domain/local-test-pepper";
import { checkPepper } from "./domain/pepper-rule";

const src = readFileSync("scripts/seed.ts", "utf8");

describe("T-111 tester: --hosted never falls back to LOCAL_TEST_PEPPER", () => {
  it("the constant is used exactly once in seed.ts, after the import, in the local else-branch", () => {
    const uses = src.split("LOCAL_TEST_PEPPER").length - 1;
    expect(uses).toBe(2); // import + the --local fallback
    const hostedStart = src.indexOf("checkPepper(process.env.HASH_PEPPER)");
    const elseIdx = src.indexOf("} else {", hostedStart);
    const useIdx = src.lastIndexOf("LOCAL_TEST_PEPPER");
    expect(hostedStart).toBeGreaterThan(-1);
    expect(useIdx).toBeGreaterThan(elseIdx);
    // the hosted branch (between the check and the else) has no fallback
    expect(src.slice(hostedStart, elseIdx)).not.toContain("LOCAL_TEST_PEPPER");
  });

  it("hosted still refuses a missing, short or whitespace-only pepper", () => {
    for (const bad of [undefined, "", "   ", "short", "x".repeat(31)]) {
      expect(checkPepper(bad).ok).toBe(false);
    }
  });

  it("the local constant is accepted by the rule only because it is 32+ characters", () => {
    expect(LOCAL_TEST_PEPPER.trim()).toBe(LOCAL_TEST_PEPPER);
    expect(checkPepper(LOCAL_TEST_PEPPER).ok).toBe(true);
  });
});
