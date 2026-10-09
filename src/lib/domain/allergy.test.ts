import { describe, expect, it } from "vitest";
import { findAllergyConflicts, splitAllergies } from "./allergy";
import { ALLERGEN_CHOICES } from "../chef/dishes";

const pho = { id: "d1", name: "Pho", allergens: ["soy", "fish"] };
const satay = { id: "d2", name: "Satay", allergens: ["peanuts", "tree nuts"] };
const rice = { id: "d3", name: "Plain rice", allergens: [] };

describe("findAllergyConflicts", () => {
  it("compares lower-case and trimmed", () => {
    expect(findAllergyConflicts("  SOY ", [pho, rice])).toEqual([
      { dishId: "d1", dishName: "Pho", allergens: ["soy"] },
    ]);
    expect(findAllergyConflicts([" Peanuts "], [satay])).toHaveLength(1);
  });
  it("splits a free-text list", () => {
    const r = findAllergyConflicts("Soy, peanuts; fish\nsesame", [pho, satay]);
    expect(r.map((c) => c.dishId)).toEqual(["d1", "d2"]);
    expect(r[0].allergens).toEqual(["soy", "fish"]);
  });
  it("matches singular and plural, and a phrase inside a sentence", () => {
    expect(findAllergyConflicts("severe peanut allergy", [satay])).toEqual([
      { dishId: "d2", dishName: "Satay", allergens: ["peanuts"] },
    ]);
    expect(findAllergyConflicts("tree nut", [satay])[0].allergens).toEqual([
      "tree nuts",
    ]);
  });
  it("does not match a different word that merely contains the letters", () => {
    expect(
      findAllergyConflicts("soybean-free diet is not an allergy", [pho]),
    ).toEqual([]);
    expect(findAllergyConflicts("nutmeg", [satay])).toEqual([]);
  });
  it("is empty with no allergies, blank text or no dish allergens", () => {
    expect(findAllergyConflicts("", [pho])).toEqual([]);
    expect(findAllergyConflicts("  ,; ", [pho])).toEqual([]);
    expect(findAllergyConflicts("soy", [rice])).toEqual([]);
    expect(findAllergyConflicts("soy", [])).toEqual([]);
  });
  it("is case-insensitive on the dish side as well", () => {
    expect(
      findAllergyConflicts("soy", [
        { id: "x", name: "X", allergens: [" SOY "] },
      ]),
    ).toHaveLength(1);
  });
});

describe("splitAllergies", () => {
  it("normalizes entries", () => {
    expect(splitAllergies(" A ,b;;C/d\r\ne ")).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });
});

describe("customer words inside a longer dish allergen (review round 2)", () => {
  const nuts = { id: "d9", name: "Cake", allergens: ["tree nuts"] };
  it.each([
    "nuts",
    "nut",
    "nut allergy",
    "I am allergic to nuts",
    "tree",
    "Tree-nut",
    "peanut and nut",
  ])("intake %j conflicts with tree nuts", (intake) => {
    expect(findAllergyConflicts(intake, [nuts])).toHaveLength(1);
  });
  it("every word of every multi-word ALLERGEN_CHOICES value, alone, is a conflict", () => {
    const multi = ALLERGEN_CHOICES.filter((c) => c.value.includes(" "));
    expect(multi.length).toBeGreaterThan(0);
    for (const c of multi)
      for (const w of c.value.split(" "))
        expect(
          findAllergyConflicts(w, [
            { id: "x", name: "X", allergens: [c.value] },
          ]),
          `${w} vs ${c.value}`,
        ).toHaveLength(1);
  });
  it("filler words alone are not a conflict", () => {
    for (const t of [
      "allergy",
      "no allergies",
      "severe",
      "gluten-free is not it",
    ])
      expect(findAllergyConflicts(t, [nuts])).toEqual([]);
  });
  it("still no match for a word that only contains the letters", () => {
    expect(findAllergyConflicts("nutmeg", [nuts])).toEqual([]);
  });
});
