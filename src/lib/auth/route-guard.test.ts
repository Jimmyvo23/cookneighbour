import { describe, expect, it } from "vitest";
import type { MeResponse } from "@/lib/api/types";
import {
  landingPath,
  nextOnboardingStep,
  redirectFor,
} from "@/lib/auth/route-guard";

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
  it("sends an unverified phone from /address back to /verify-phone", () => {
    expect(redirectFor("/address", me(false, false))).toBe("/verify-phone");
  });
});

function asRole(
  m: MeResponse,
  role: "customer" | "chef" | "admin",
): MeResponse {
  return { ...m, profile: { ...m.profile, role } };
}

describe("chef pages (client-side second layer; the server guard is the real one)", () => {
  it("sends signed-out visitors of /chef/* to /login", () => {
    expect(redirectFor("/chef/apply", null)).toBe("/login");
  });
  it("sends customers and admins away from /chef/*", () => {
    expect(redirectFor("/chef/apply", me(true, true))).toBe("/");
    expect(redirectFor("/chef/apply", asRole(me(true, true), "admin"))).toBe(
      "/",
    );
  });
  it("lets a chef in", () => {
    expect(
      redirectFor("/chef/apply", asRole(me(true, true), "chef")),
    ).toBeNull();
  });
  it("does not treat a similar path as a chef page", () => {
    expect(redirectFor("/chefs", me(true, true))).toBeNull();
  });
});

describe("landingPath", () => {
  it("finishes onboarding first", () => {
    expect(landingPath(asRole(me(false, false), "chef"))).toBe("/verify-phone");
  });
  it("sends a chef to the application, others home", () => {
    expect(landingPath(asRole(me(true, true), "chef"))).toBe("/chef/apply");
    expect(landingPath(me(true, true))).toBe("/");
  });
});
