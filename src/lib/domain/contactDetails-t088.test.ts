// T-088: the phone rule only refuses North American shapes (10 digits, or 11 starting with 1).
import { describe, expect, it } from "vitest";
import { findContactDetails } from "./contactDetails";

describe("T-088 phone shapes are refused", () => {
  it.each([
    "416 555 0199",
    "(416) 555-0199",
    "416.555.0199",
    "4165550199",
    "+1 416 555 0199",
    "1-416-555-0199",
    "1 (416) 555 0199",
    "reach me: 416 555 0199 ext 5", // extension: the 10 digits before it decide
    "416 555 0199 or 647 555 0100", // two numbers
    "ref 12345 then 416 555 0199", // phone embedded after other numbers
  ])("%j", (t) => expect(findContactDetails(t)).toBe("phone"));
});

describe("T-088 other digit runs pass", () => {
  it.each([
    "order 20261031",
    "2026-10-31",
    "555-0199",
    "text 555 0199 please",
    "123456789", // 9 digits
    "123456789012", // 12 in a row: not a phone shape
    "12345678901234567", // 17 in a row
    "+44 20 7946 0958", // 12 digits, not North American
    "$1,234.56",
    "$12,345,678.90",
    "call 416 555 or 0199 now", // halves split by text are not joined
    "555-0199 ext 5", // extension on a 7-digit number
    "10.5.2026",
    "21234567890", // 11 digits not starting with 1
  ])("%j", (t) => expect(findContactDetails(t)).toBeNull());
});

describe("T-088 emails and links unchanged", () => {
  it("email", () => expect(findContactDetails("a@b.co")).toBe("email"));
  it("url", () => expect(findContactDetails("example.com/x")).toBe("url"));
});
