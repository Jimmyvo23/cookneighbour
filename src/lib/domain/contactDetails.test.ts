import { describe, expect, it } from "vitest";
import { findContactDetails } from "./contactDetails";

describe("findContactDetails (best effort)", () => {
  it.each([
    "call me on 416-555-0199",
    "416 555 0199",
    "(416) 555-0199",
    "+1 416.555.0199",
    "4165550199",
    "text 555 0199 please",
    "1-800-555-0199 ext 5",
  ])("finds a phone number in %j", (t) => {
    expect(findContactDetails(t)).toBe("phone");
  });
  it.each(["me@example.com", "write to a.b+c@mail.example.ca soon"])(
    "finds an email in %j",
    (t) => expect(findContactDetails(t)).toBe("email"),
  );
  it.each([
    "see https://example.com/x",
    "www.example.org",
    "my page is example.com/menu",
  ])("finds a URL in %j", (t) => expect(findContactDetails(t)).toBe("url"));
  it.each([
    "Sorry, I am away that week.",
    "I can do 2 or 3 days, 6 hours each",
    "Fully booked on 2026-10-20 and 2026-10-21",
    "Order 12345 is too small",
    "Open 9.30 to 5.30 daily",
    "Dr. Smith's kitchen, e.g. pho",
  ])("leaves ordinary text alone: %j", (t) => {
    expect(findContactDetails(t)).toBeNull();
  });
  it("does not detect street addresses (known limit)", () => {
    expect(
      findContactDetails("I live at 12 Main Street, Mississauga"),
    ).toBeNull();
  });
});
