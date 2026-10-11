// T-042 round 2 Tester: edge cases for findContactDetails (D-34). Best effort: these pin down
// what is caught and what is let through, including the known limits.
import { describe, expect, it } from "vitest";
import { findContactDetails } from "./contactDetails";

describe("phone forms are caught", () => {
  it.each([
    "Call +1 (905) 555-0123",
    "905.555.0123",
    "9055550123",
    "555 0123",
    "555-0123",
    "1 905 555 0123",
    "call me 905 555 0123 pls",
    "call 9 0 5 5 5 5 0 1 2 3",
    "tel:+19055550123",
    "+44 20 7946 0958",
  ])("%j", (t) => expect(findContactDetails(t)).toBe("phone"));
});

describe("ordinary reasons pass", () => {
  it.each([
    "I am away 2026-10-20",
    "Cannot do 2026-10-20 to 2026-10-22",
    "price $1,200.50 for 3 days",
    "Too long: 3 days is more than I can do",
    "I only have 6 hours and 12 people is too many",
    "Booked on 20/10/2026",
    "Oct 20 2026 at 10:30",
    "$100,000",
    "Starting at 1.30pm... see you.Tuesday",
    "Mr. Smith.Thanks",
    "no.1 on my list",
    "It costs 2.5kg. Thanks.Bye",
    "my insta @chef_x",
    "zip 12345",
  ])("%j", (t) => expect(findContactDetails(t)).toBeNull());
});

describe("email and links", () => {
  it.each([
    ["a@b.co", "email"],
    ["write me at USER@EXAMPLE.COM", "email"],
    ["visit example.com/me", "url"],
    ["www.x.ca", "url"],
    ["http://localhost", "url"],
    ["https://x.y/z", "url"],
    ["mydomain.ca", "url"],
    ["wa.me/123", "url"],
    ["bit.ly/abc", "url"],
  ])("%j is %s", (t, kind) => expect(findContactDetails(t)).toBe(kind));
});

describe("known limits (documented, not bugs)", () => {
  it.each([
    "a at b dot com",
    "nine zero five five five five zero one two three",
    "I live at 12 Main Street, Mississauga",
  ])("lets through %j", (t) => expect(findContactDetails(t)).toBeNull());

  it("a dotted date such as 10.5.2026 is flagged as a phone (false positive, Low)", () => {
    expect(findContactDetails("10.5.2026")).toBe("phone");
  });
});
