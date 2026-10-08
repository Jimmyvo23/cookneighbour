import { describe, expect, it } from "vitest";
import {
  validateAddress,
  validateCode,
  validateLogin,
  validatePhone,
  validateSignUp,
} from "@/lib/validation/auth";

describe("validateSignUp", () => {
  const ok = {
    email: "a@b.co",
    password: "12345678",
    role: "chef",
    displayName: "Lan",
  };
  it("accepts a valid form", () => expect(validateSignUp(ok)).toEqual({}));
  it("rejects bad email, short and long password, bad role, empty and long name", () => {
    expect(validateSignUp({ ...ok, email: "nope" }).email).toBeDefined();
    expect(
      validateSignUp({ ...ok, password: "1234567" }).password,
    ).toBeDefined();
    expect(
      validateSignUp({ ...ok, password: "x".repeat(73) }).password,
    ).toBeDefined();
    expect(validateSignUp({ ...ok, role: "admin" }).role).toBeDefined();
    expect(
      validateSignUp({ ...ok, displayName: "  " }).displayName,
    ).toBeDefined();
    expect(
      validateSignUp({ ...ok, displayName: "x".repeat(81) }).displayName,
    ).toBeDefined();
  });
});

describe("validateLogin", () => {
  it("requires both fields", () => {
    expect(
      Object.keys(validateLogin({ email: "", password: "" })).sort(),
    ).toEqual(["email", "password"]);
    expect(validateLogin({ email: "a@b.co", password: "x" })).toEqual({});
  });
});

describe("validatePhone and validateCode", () => {
  it("accepts common Canadian formats", () => {
    for (const p of [
      "416 555 0123",
      "(416) 555-0123",
      "+1 416-555-0123",
      "4165550123",
    ])
      expect(validatePhone({ phone: p })).toEqual({});
  });
  it("rejects malformed numbers", () => {
    for (const p of ["", "12345", "+44 20 7946 0958", "416555012"])
      expect(validatePhone({ phone: p }).phone).toBeDefined();
  });
  it("code must be exactly 6 digits", () => {
    expect(validateCode({ code: "123456" })).toEqual({});
    for (const c of ["12345", "1234567", "abcdef", "12 456", ""])
      expect(validateCode({ code: c }).code).toBeDefined();
  });
});

describe("validateAddress", () => {
  it("accepts a normal address and flexible postal formats", () => {
    for (const pc of ["L5B 1M2", "l5b1m2", "L5B-1M2"])
      expect(
        validateAddress({
          line: "1 Main St",
          city: "Mississauga",
          postalCode: pc,
        }),
      ).toEqual({});
  });
  it("rejects empty fields and bad postal code", () => {
    const e = validateAddress({ line: "", city: "", postalCode: "12345" });
    expect(Object.keys(e).sort()).toEqual(["city", "line", "postalCode"]);
  });
});
