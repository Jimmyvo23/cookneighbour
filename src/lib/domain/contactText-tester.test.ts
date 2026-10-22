// T-101 tester: false positives and look-alike variants on every new field (D-147), saved intake.
import { describe, expect, it } from "vitest";
import { CONTACT_FIELD_MESSAGE, contactProblem } from "./contactText";
import { parseDishBody } from "./dishes";
import { parseUpdateBody } from "./chef-application";
import { parseIntake } from "./bookingRequest";
import { parseSavedIntake, readSavedIntake } from "./savedIntake";
import { displayNameProblem } from "@/lib/validation/auth";
import { intakeProblems } from "@/lib/booking/form";

const OK = [
  "Cooking since 1985",
  "Serves 4-6",
  "2 cups rice, 350F for 45 min",
  "pho bo 2 bowls",
  "Phở bò tái, bánh mì, gỏi cuốn - nấu ăn từ năm 1990",
  "Bún chả Hà Nội, 6 người ăn, 45 phút",
  "I have cooked for 30 years, 12 grandchildren and 3 sons. Rate $25.50 per hour",
  "Ready in 1 hr 30 min, serves 8-10, costs about $12-15",
  "Since 2005-2010 I ran a kitchen with 150 seats",
  "Order #123456 on 2026-10-20",
  "Peanuts, tree nuts (almonds 100g), shellfish 2x per week",
  "Allergic to eggs. No dairy.",
  "Dr. Smith said 1.5 L water daily; vitamin B12 1000 mcg",
];
const BAD = [
  "call 416 555 0199",
  "416-555-0199",
  "(416) 555-0199",
  "+1 416 555 0199",
  "４１６ ５５５ ０１９９", // full-width digits
  "email me at anna@example.com",
  "ａｎｎａ＠ｅｘａｍｐｌｅ．ｃｏｍ", // full-width email
  "https://example.com/x",
  "www.annacooks.ca",
  "annacooks.com",
  "4 1 6 - 5 5 5 - 0 1 9 9",
  "416–555–0199", // en dash
];

describe("T-101 false positives pass on every new field", () => {
  for (const t of OK) {
    it(JSON.stringify(t), () => {
      expect(contactProblem(t)).toBeNull();
      expect(displayNameProblem(t.slice(0, 40))).not.toBe(
        CONTACT_FIELD_MESSAGE,
      );
      expect(parseUpdateBody({ bio: t }).errors.bio).not.toBe(
        CONTACT_FIELD_MESSAGE,
      );
      const d = parseDishBody(
        {
          name: t.slice(0, 60),
          description: t,
          cuisine: "vietnamese",
          cookMinutes: 60,
        },
        "create",
      );
      expect(d.errors.name).not.toBe(CONTACT_FIELD_MESSAGE);
      expect(d.errors.description).not.toBe(CONTACT_FIELD_MESSAGE);
      const i = parseIntake({
        noAllergies: false,
        allergens: [],
        allergyNotes: t,
        noDietaryNeeds: false,
        dietaryNotes: t,
      });
      expect(i.invalid["intake.allergyNotes"]).not.toBe(CONTACT_FIELD_MESSAGE);
      expect(i.invalid["intake.dietaryNotes"]).not.toBe(CONTACT_FIELD_MESSAGE);
    });
  }
});

describe("T-101 contact variants are refused on every new field", () => {
  for (const t of BAD) {
    it(JSON.stringify(t), () => {
      expect(displayNameProblem(t)).toBe(CONTACT_FIELD_MESSAGE);
      expect(parseUpdateBody({ bio: t }).errors.bio).toBe(
        CONTACT_FIELD_MESSAGE,
      );
      const d = parseDishBody(
        { name: t, description: t, cuisine: "vietnamese", cookMinutes: 60 },
        "create",
      );
      expect(d.errors.name).toBe(CONTACT_FIELD_MESSAGE);
      expect(d.errors.description).toBe(CONTACT_FIELD_MESSAGE);
      const i = parseIntake({
        noAllergies: false,
        allergens: [],
        allergyNotes: t,
        noDietaryNeeds: false,
        dietaryNotes: t,
      });
      expect(i.invalid["intake.allergyNotes"]).toBe(CONTACT_FIELD_MESSAGE);
      expect(i.invalid["intake.dietaryNotes"]).toBe(CONTACT_FIELD_MESSAGE);
      const e = intakeProblems({
        noAllergies: false,
        allergens: [],
        allergyNotes: t,
        noDietaryNeeds: false,
        dietaryNotes: t,
      });
      expect(e["intake.allergies"]).toBe(CONTACT_FIELD_MESSAGE);
      expect(e["intake.dietaryNotes"]).toBe(CONTACT_FIELD_MESSAGE);
    });
  }
});

describe("T-101 saved intake with contact text", () => {
  const stored = {
    noAllergies: false,
    allergens: [],
    allergyNotes: "text me 416-555-0199",
    noDietaryNeeds: true,
  };
  it("a new save is refused with a field error naming allergyNotes", () => {
    const r = parseSavedIntake(stored);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fields.allergyNotes).toBe(CONTACT_FIELD_MESSAGE);
  });
  it("a legacy stored row that fails now reads as nothing saved (documented gap, no error)", () => {
    expect(readSavedIntake(stored)).toBeNull();
  });
});

describe("T-101 invisible characters inside a number are still refused", () => {
  it("display name is refused (by the invisible-text rule or the contact rule)", () => {
    expect(displayNameProblem("416\u200b555\u200b0199")).not.toBeNull();
  });
  it("contactProblem sees through them", () => {
    expect(contactProblem("416\u200b555\u200b0199")).toBe(
      CONTACT_FIELD_MESSAGE,
    );
  });
});
