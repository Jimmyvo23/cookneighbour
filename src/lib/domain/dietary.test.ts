import { describe, expect, it } from "vitest";
import { chefMatchesDietary, dishAvoidsAllergens } from "./dietary";

const d = (allergens: string[], isActive = true) => ({ allergens, isActive });

describe("chefMatchesDietary (A-17)", () => {
  it("matches when at least one active dish is free of every selected allergen", () => {
    expect(chefMatchesDietary([d(["soy"]), d(["peanuts"])], ["soy"])).toBe(
      true,
    );
    expect(chefMatchesDietary([d([])], ["soy", "peanuts"])).toBe(true);
  });
  it("does not match when every active dish has one of the allergens", () => {
    expect(
      chefMatchesDietary([d(["soy"]), d(["peanuts"])], ["soy", "peanuts"]),
    ).toBe(false);
  });
  it("ignores inactive dishes", () => {
    expect(chefMatchesDietary([d([], false), d(["soy"])], ["soy"])).toBe(false);
    expect(chefMatchesDietary([], ["soy"])).toBe(false);
  });
  it("compares lower-case and trimmed", () => {
    expect(chefMatchesDietary([d(["Soy "])], [" SOY"])).toBe(false);
    expect(dishAvoidsAllergens(d(["tree nuts"]), ["Tree Nuts"])).toBe(false);
  });
  it("no selection matches everyone, even a chef with no dishes", () => {
    expect(chefMatchesDietary([], [])).toBe(true);
    expect(chefMatchesDietary([], ["  "])).toBe(true);
  });
});

// D-31 (T-042): the search filter understands the same synonyms as the booking allergy warning.
describe("synonyms in the search filter (D-31)", () => {
  it("avoiding gluten also avoids a dish listing wheat or barley", () => {
    expect(dishAvoidsAllergens(d(["wheat"]), ["gluten"])).toBe(false);
    expect(dishAvoidsAllergens(d(["barley"]), ["gluten"])).toBe(false);
    expect(dishAvoidsAllergens(d(["oats"]), ["celiac"])).toBe(false);
  });
  it("avoiding dairy, shrimp or nuts finds the dishes the booking would warn about", () => {
    expect(dishAvoidsAllergens(d(["milk"]), ["dairy"])).toBe(false);
    expect(dishAvoidsAllergens(d(["crustaceans"]), ["shrimp"])).toBe(false);
    expect(dishAvoidsAllergens(d(["tree nuts"]), ["nuts"])).toBe(false);
    expect(dishAvoidsAllergens(d(["peanuts"]), ["tree nuts"])).toBe(false);
    expect(dishAvoidsAllergens(d(["sulphites"]), ["sulfites"])).toBe(false);
  });
  it("keeps dishes that have nothing to do with the avoided words", () => {
    expect(dishAvoidsAllergens(d(["fish"]), ["gluten", "dairy"])).toBe(true);
    expect(dishAvoidsAllergens(d([]), ["gluten"])).toBe(true);
    expect(dishAvoidsAllergens(d(["sesame"]), ["soy"])).toBe(true);
  });
  it("a chef matches when one active dish is free of every avoided word", () => {
    expect(chefMatchesDietary([d(["wheat"]), d(["fish"])], ["gluten"])).toBe(
      true,
    );
    expect(chefMatchesDietary([d(["wheat"])], ["gluten"])).toBe(false);
  });
  it("uses every avoided entry, each on its own", () => {
    expect(dishAvoidsAllergens(d(["milk"]), ["gluten", "dairy"])).toBe(false);
    expect(dishAvoidsAllergens(d(["fish"]), ["gluten", "dairy"])).toBe(true);
  });
});
