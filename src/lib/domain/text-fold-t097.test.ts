// T-097 Tester: pins the contract v1.22 statement. Known limits (Jimmy D-146) stay accepted on a
// display name and an address line; accent-only and fold-removed-only values stay refused; the
// browser display-name message equals the server standard message.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { parseBookingBody } from "./bookingRequest";
import { hasNoVisibleText, NO_VISIBLE_TEXT } from "./text-fold";
import { displayNameProblem, validateSignUp } from "@/lib/validation/auth";

const LIMITS: [string, string][] = [
  ["3164", "ㅤ"],
  ["00AD", "­"],
  ["200E", "‎"],
  ["200F", "‏"],
  ["2061", "⁡"],
  ["180E", "᠎"],
];
const REFUSED: [string, string][] = [
  ["accent only", "́"],
  ["accents range ends", "̀ͯ"],
  ["ZWNJ", "‌"],
  ["ZWJ", "‍"],
  ["ZWNJ+ZWJ+space", " ‌ ‍ "],
  ["ZWSP", "​"],
  ["BOM", "﻿"],
  ["word joiner", "⁠"],
  ["bidi", "‮"],
];
const ID = "11111111-1111-4111-8111-111111111111";
const addr = (line: string) =>
  parseBookingBody(
    {
      chefId: ID,
      locationType: "customer_home",
      address: { line, city: "Mississauga", postalCode: "L5B 1A1" },
    },
    "estimate",
  ).errors["address.line"];

describe("T-097 known limits stay accepted (D-146)", () => {
  it.each(LIMITS)("U+%s alone: hasNoVisibleText false", (_n, c) => {
    expect(hasNoVisibleText(c)).toBe(false);
    expect(hasNoVisibleText(c.repeat(3))).toBe(false);
  });
  it.each(LIMITS)("U+%s alone: display name accepted (browser)", (_n, c) => {
    expect(displayNameProblem(c)).toBeNull();
    expect(
      validateSignUp({
        email: "a@b.co",
        password: "Password123!",
        role: "customer",
        displayName: c,
      }).displayName,
    ).toBeUndefined();
  });
  it.each(LIMITS)("U+%s alone: address line accepted (server)", (_n, c) => {
    expect(addr(c)).toBeUndefined();
  });
});

describe("T-097 nothing visible after the fold stays refused", () => {
  it.each(REFUSED)("%s: no visible text", (_n, c) => {
    expect(hasNoVisibleText(c)).toBe(true);
  });
  it("accent-only display name gets the standard message", () => {
    expect(displayNameProblem("́̂")).toBe(NO_VISIBLE_TEXT);
  });
  it("accent-only address line gets the standard message", () => {
    expect(addr("́")).toBe(NO_VISIBLE_TEXT);
    expect(addr("‌‍")).toBe(NO_VISIBLE_TEXT);
  });
  it("a letter with an accent, and non-Latin names, still pass", () => {
    expect(hasNoVisibleText("é")).toBe(false);
    expect(displayNameProblem("Nguyễn Văn")).toBeNull();
    expect(displayNameProblem("李小龍")).toBeNull();
  });
});

describe("T-097 browser display-name message equals the server's", () => {
  const std = "Remove control or invalid characters.";
  it("unsafe text gives the server standard message", () => {
    expect(displayNameProblem("Mai\u0007")).toBe(std);
    const e = validateSignUp({
      email: "a@b.co",
      password: "Password123!",
      role: "customer",
      displayName: "Mai\u0007",
    });
    expect(e.displayName).toBe(std);
    const s = parseBookingBody(
      {
        chefId: ID,
        locationType: "customer_home",
        address: { line: "x\u0007", city: "Mississauga", postalCode: "L5B1A1" },
      },
      "estimate",
    ).errors["address.line"];
    expect(s).toBe(std);
  });
});

describe("T-097 round 1: exact messages by case (contract v1.22)", () => {
  it("a spacing accent such as U+00B4 alone is refused as no visible character", () => {
    expect(displayNameProblem("´")).toBe(NO_VISIBLE_TEXT);
    expect(hasNoVisibleText("´")).toBe(true);
  });
  it("U+200B alone gets the unsafe message, not the no-visible one", () => {
    expect(displayNameProblem("​")).toBe(
      "Remove control or invalid characters.",
    );
  });
});
