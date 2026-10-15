import { describe, expect, it } from "vitest";
import { emptyDraft } from "@/lib/booking/form";
import {
  draftFromSaved,
  intakeFromDraft,
  intakeIsUntouched,
  sameIntake,
} from "@/lib/booking/savedIntake";
import { parseSavedIntake } from "@/lib/domain/savedIntake";

const SAVED = {
  noAllergies: false,
  allergens: ["peanuts", "milk"],
  allergyNotes: "carries an EpiPen",
  noDietaryNeeds: false,
  dietaryNotes: "halal",
};

describe("saved intake to draft and back", () => {
  it("fills the five intake fields and clears the conflict tick", () => {
    const d = { ...emptyDraft(), conflictAcknowledged: true };
    const out = { ...d, ...draftFromSaved(SAVED) };
    expect(out.allergens).toEqual(["peanuts", "milk"]);
    expect(out.allergyNotes).toBe("carries an EpiPen");
    expect(out.dietaryNotes).toBe("halal");
    expect(out.noAllergies).toBe(false);
    expect(out.conflictAcknowledged).toBe(false);
  });

  it("round trips: what the server saved is what the PUT sends", () => {
    const d = { ...emptyDraft(), ...draftFromSaved(SAVED) };
    expect(intakeFromDraft(d)).toEqual(SAVED);
  });

  it("builds a body the real server validation accepts (no allergies, no needs)", () => {
    const d = { ...emptyDraft(), noAllergies: true, noDietaryNeeds: true };
    const body = intakeFromDraft(d);
    expect(body).toEqual({
      noAllergies: true,
      allergens: [],
      allergyNotes: "",
      noDietaryNeeds: true,
      dietaryNotes: "",
    });
    expect(parseSavedIntake(body).ok).toBe(true);
  });

  it("trims the free text and drops allergens when 'no allergies' is ticked", () => {
    const d = {
      ...emptyDraft(),
      noAllergies: true,
      allergens: ["soy"],
      allergyNotes: "  x ",
      dietaryNotes: "  halal ",
    };
    const b = intakeFromDraft(d);
    expect(b.allergens).toEqual([]);
    expect(b.allergyNotes).toBe("");
    expect(b.dietaryNotes).toBe("halal");
  });

  it("sameIntake ignores case, order and spaces", () => {
    expect(
      sameIntake(SAVED, {
        ...SAVED,
        allergens: ["Milk", "peanuts"],
        allergyNotes: " carries an EpiPen ",
      }),
    ).toBe(true);
    expect(sameIntake(SAVED, { ...SAVED, dietaryNotes: "vegan" })).toBe(false);
  });

  it("knows when the customer has not typed anything yet", () => {
    expect(intakeIsUntouched(emptyDraft())).toBe(true);
    expect(intakeIsUntouched({ ...emptyDraft(), noAllergies: true })).toBe(
      false,
    );
    expect(intakeIsUntouched({ ...emptyDraft(), dietaryNotes: "a" })).toBe(
      false,
    );
    expect(intakeIsUntouched({ ...emptyDraft(), allergens: ["soy"] })).toBe(
      false,
    );
  });
});
