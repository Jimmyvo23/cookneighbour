import { describe, expect, it } from "vitest";
import type { MeResponse } from "@/lib/api/types";
import { nextOnboardingStep, redirectFor } from "@/lib/auth/route-guard";

function me(phoneVerified: boolean, hasAddress: boolean): MeResponse {
  return {
    profile: {
      id: "u1",
      role: "customer",
      displayName: "Mai",
      country: "CA",
      currency: "CAD",
      language: "en",
    },
    private: {
      phoneMasked: phoneVerified ? "+1******0123" : null,
      phoneVerified,
      address: hasAddress
        ? {
            line: "1 Main St",
            city: "Mississauga",
            postalCode: "L5B1M2",
            postalPrefix: "L5B",
          }
        : null,
    },
    chef: null,
  };
}

describe("nextOnboardingStep", () => {
  it("asks for the phone first", () => {
    expect(nextOnboardingStep(me(false, false))).toBe("/verify-phone");
    expect(nextOnboardingStep(me(false, true))).toBe("/verify-phone");
  });
  it("then the address", () => {
    expect(nextOnboardingStep(me(true, false))).toBe("/address");
  });
  it("then nothing", () => {
    expect(nextOnboardingStep(me(true, true))).toBeNull();
  });
});

describe("redirectFor", () => {
  it("sends signed-out visitors of private steps to /login", () => {
    expect(redirectFor("/verify-phone", null)).toBe("/login");
    expect(redirectFor("/address", null)).toBe("/login");
  });
  it("lets signed-out visitors see public pages", () => {
    for (const p of ["/", "/login", "/signup"])
      expect(redirectFor(p, null)).toBeNull();
  });
  it("sends signed-in users away from /login and /signup", () => {
    expect(redirectFor("/login", me(true, true))).toBe("/");
    expect(redirectFor("/signup", me(false, false))).toBe("/");
  });
  it("lets signed-in users use the onboarding steps", () => {
    expect(redirectFor("/verify-phone", me(false, false))).toBeNull();
    expect(redirectFor("/address", me(true, false))).toBeNull();
  });
});
