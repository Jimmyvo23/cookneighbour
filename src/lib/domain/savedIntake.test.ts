import { describe, expect, it } from "vitest";
import { parseBookingBody } from "./bookingRequest";
import { parseSavedIntake, readSavedIntake } from "./savedIntake";

describe("parseSavedIntake (D-23 rules, plain field keys)", () => {
  it("accepts explicit 'none' answers", () => {
    const r = parseSavedIntake({ noAllergies: true, noDietaryNeeds: true });
    expect(r).toEqual({
      ok: true,
      form: {
        noAllergies: true,
        allergens: [],
        allergyNotes: "",
        noDietaryNeeds: true,
        dietaryNotes: "",
      },
    });
  });

  it("normalizes picked allergens and trims notes", () => {
    const r = parseSavedIntake({
      allergens: [" Peanuts ", "peanuts", "WHEAT"],
      allergyNotes: "  EpiPen ",
      dietaryNotes: " halal ",
    });
    expect(r).toEqual({
      ok: true,
      form: {
        noAllergies: false,
        allergens: ["peanuts", "wheat"],
        allergyNotes: "EpiPen",
        noDietaryNeeds: false,
        dietaryNotes: "halal",
      },
    });
  });

  it("refuses blank answers with plain keys", () => {
    const r = parseSavedIntake({});
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(Object.keys(r.fields).sort()).toEqual([
        "allergies",
        "dietaryNotes",
      ]);
  });

  it("refuses contradictions, unknown keys and values, unsafe and long text", () => {
    const bad = (b: unknown) => {
      const r = parseSavedIntake(b);
      expect(r.ok).toBe(false);
      return r.ok ? {} : r.fields;
    };
    expect(
      bad({ noAllergies: true, allergens: ["milk"], noDietaryNeeds: true }),
    ).toHaveProperty("noAllergies");
    expect(
      bad({ noAllergies: true, noDietaryNeeds: true, extra: 1 }),
    ).toHaveProperty("extra");
    expect(
      bad({ allergens: ["kryptonite"], noDietaryNeeds: true }),
    ).toHaveProperty("allergens");
    expect(
      bad({ allergyNotes: "a\u0000b", noDietaryNeeds: true }),
    ).toHaveProperty("allergyNotes");
    expect(
      bad({ allergyNotes: "x".repeat(301), noDietaryNeeds: true }),
    ).toHaveProperty("allergyNotes");
    expect(bad({ noAllergies: "yes", noDietaryNeeds: true })).toHaveProperty(
      "noAllergies",
    );
    expect(bad("text")).toHaveProperty("body");
    expect(bad(null)).toHaveProperty("body");
  });

  it("a saved form is accepted unchanged as a booking intake", () => {
    const r = parseSavedIntake({
      allergens: ["milk"],
      noDietaryNeeds: true,
    });
    if (!r.ok) throw new Error("expected ok");
    const b = parseBookingBody(
      {
        chefId: "0b3f0e0e-5b9f-4f0e-8d57-7a8f3f6a1c11",
        locationType: "chef_home",
        days: [
          {
            date: "2026-10-20",
            dishes: [{ dishId: "1c4f1f1f-6caf-4f1f-9e68-8b9f4f7b2d22" }],
          },
        ],
        groceryOption: "customer_buys",
        intake: r.form,
      },
      "create",
    );
    expect(b.errors).toEqual({});
    expect(b.value?.intake).toEqual({
      allergies: "milk",
      dietaryNotes: "None",
    });
  });
});

describe("readSavedIntake", () => {
  it("returns null for anything that is not a valid form", () => {
    expect(readSavedIntake(null)).toBeNull();
    expect(readSavedIntake({})).toBeNull();
    expect(readSavedIntake("x")).toBeNull();
  });
});
