// T-088 tester: edge cases for the North American phone rule (D-106 wording from Jimmy, 2026-10-20).
import { describe, expect, it } from "vitest";
import { findContactDetails } from "./contactDetails";

describe("T-088 tester: refused", () => {
  it.each([
    "416 555\n0199", // phone across a line break
    "416\n555\n0199",
    "416-555-0199\n",
    "+1 (416) 555-0199",
    "1-800-555-0199",
    "M5V 2T6 416 555 0199", // postal code next to a phone
    "M5V 2T6 and 4165550199",
    "4 1 6 5 5 5 0 1 9 9", // spaced single digits
    "416 555 0199", // non-breaking spaces
  ])("%j", (t) => expect(findContactDetails(t)).toBe("phone"));
});

describe("T-088 tester: passes", () => {
  it.each([
    "L5B 3Y3", // postal code alone
    "Postal code L5B 3Y3 please",
    "0416 555 0199", // 11 digits starting with 0 is not a North American shape
    "04165550199",
    "Order 20261031 on 2026-10-31",
  ])("%j", (t) => expect(findContactDetails(t)).toBeNull());
});
