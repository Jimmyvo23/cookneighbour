// T-111: the seed's --local fallback and the e2e app share one throwaway pepper.
import { describe, expect, it } from "vitest";
import { LOCAL_TEST_PEPPER } from "./local-test-pepper";
import { checkPepper } from "./pepper-rule";

describe("LOCAL_TEST_PEPPER", () => {
  it("passes the app's pepper rule", () => {
    expect(checkPepper(LOCAL_TEST_PEPPER)).toEqual({
      ok: true,
      pepper: LOCAL_TEST_PEPPER,
    });
  });
});
