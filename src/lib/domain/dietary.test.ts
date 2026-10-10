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
