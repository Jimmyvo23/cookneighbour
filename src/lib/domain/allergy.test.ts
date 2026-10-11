import { describe, expect, it } from "vitest";
import { FILLER, findAllergyConflicts, splitAllergies } from "./allergy";
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
      // D-24: peanut and nut are one synonym group, so the tree-nuts entry warns too.
      {
        dishId: "d2",
        dishName: "Satay",
        allergens: ["peanuts", "tree nuts"],
      },
    ]);
    expect(findAllergyConflicts("tree nut", [satay])[0].allergens).toEqual([
      "peanuts",
      "tree nuts",
    ]);
  });
  it("does not match a different word that merely contains the letters", () => {
    expect(findAllergyConflicts("nutmeg", [satay])).toEqual([]);
    expect(findAllergyConflicts("soymilk-free", [pho])).toEqual([]);
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

describe("any intake word inside the allergen (review round 3)", () => {
  const nuts = { id: "d9", name: "Cake", allergens: ["tree nuts"] };
  it.each([
    "Extremely allergic to nuts",
    "really bad nut allergy",
    "nuts (anaphylaxis)",
    "nuts - carries epipen",
    "my son: nuts",
  ])("intake %j conflicts with tree nuts", (intake) => {
    expect(findAllergyConflicts(intake, [nuts])).toHaveLength(1);
  });
  it("no filler word is a word of an ALLERGEN_CHOICES value (singular or plural)", () => {
    const allergenWords = new Set(
      ALLERGEN_CHOICES.flatMap((c) =>
        c.value.split(" ").flatMap((w) => [w, w.replace(/s$/, "")]),
      ),
    );
    for (const f of FILLER) expect(allergenWords.has(f), f).toBe(false);
  });
});

// D-24 (T-061): a small fixed synonym and spelling map for the picker allergens. Over-warning is
// accepted; a missed allergy is not.
describe("synonyms and spellings (D-24)", () => {
  const dish = (allergen: string) => [
    { id: "x", name: "X", allergens: [allergen] },
  ];
  const pairs: [string, string][] = [
    ["gluten", "wheat"],
    ["dairy", "milk"],
    ["lactose", "milk"],
    ["dairy", "lactose"],
    ["shellfish", "crustaceans"],
    ["shrimp", "crustaceans"],
    ["prawns", "crustaceans"],
    ["crab", "crustaceans"],
    ["shellfish", "molluscs"],
    ["clams", "molluscs"],
    ["squid", "molluscs"],
    ["nuts", "peanuts"],
    ["peanuts", "tree nuts"],
    ["almonds", "tree nuts"],
    ["soya", "soy"],
    ["mollusks", "molluscs"],
    ["mollusc", "molluscs"],
    ["sulfites", "sulphites"],
    ["sulfite", "sulphites"],
  ];
  it.each(pairs)(
    "intake %j conflicts with a dish allergen %j, both ways",
    (a, b) => {
      expect(findAllergyConflicts(a, dish(b)), `${a} -> ${b}`).toHaveLength(1);
      expect(findAllergyConflicts(b, dish(a)), `${b} -> ${a}`).toHaveLength(1);
    },
  );
  it("works inside a sentence and with plural spellings", () => {
    expect(
      findAllergyConflicts("severe lactose intolerance", dish("milk")),
    ).toHaveLength(1);
    expect(findAllergyConflicts("allergic to soya", dish("soy"))).toHaveLength(
      1,
    );
    expect(findAllergyConflicts("wheat allergy", dish("gluten"))).toHaveLength(
      1,
    );
  });
  it("reports the dish's own allergen text, not the customer's word", () => {
    expect(findAllergyConflicts("dairy", dish("milk"))[0].allergens).toEqual([
      "milk",
    ]);
  });
  it("every picker allergen is matched by its own spelling variants", () => {
    const variants: Record<string, string[]> = {
      milk: ["dairy", "lactose"],
      soy: ["soya"],
      wheat: ["gluten"],
      gluten: ["wheat"],
      crustaceans: ["shellfish", "shrimp"],
      molluscs: ["mollusks", "shellfish"],
      sulphites: ["sulfites"],
      peanuts: ["nuts"],
      "tree nuts": ["peanuts", "nuts"],
    };
    for (const [value, list] of Object.entries(variants)) {
      expect(
        ALLERGEN_CHOICES.some((c) => c.value === value),
        value,
      ).toBe(true);
      for (const v of list)
        expect(
          findAllergyConflicts(v, dish(value)),
          `${v} vs ${value}`,
        ).toHaveLength(1);
    }
  });
  it("does not make unrelated allergens match", () => {
    expect(findAllergyConflicts("fish", dish("shellfish"))).toEqual([]);
    expect(findAllergyConflicts("eggs", dish("milk"))).toEqual([]);
    expect(findAllergyConflicts("sesame", dish("soy"))).toEqual([]);
    expect(findAllergyConflicts("mustard", dish("wheat"))).toEqual([]);
    expect(findAllergyConflicts("nutmeg", dish("peanuts"))).toEqual([]);
  });
});

// D-32 (T-042): Health Canada's gluten sources, the condition words, and bare nut/soy words.
describe("gluten sources and bare words (D-32)", () => {
  const dish = (allergen: string) => [
    { id: "x", name: "X", allergens: [allergen] },
  ];
  const gluten = [
    "barley",
    "rye",
    "oat",
    "oats",
    "triticale",
    "spelt",
    "kamut",
    "celiac",
    "coeliac",
  ];
  it.each(gluten)("%s conflicts with gluten and wheat, both ways", (w) => {
    expect(findAllergyConflicts(w, dish("gluten")), w).toHaveLength(1);
    expect(findAllergyConflicts(w, dish("wheat")), w).toHaveLength(1);
    expect(findAllergyConflicts("gluten", dish(w)), w).toHaveLength(1);
    expect(findAllergyConflicts("wheat", dish(w)), w).toHaveLength(1);
  });
  it("works inside a sentence", () => {
    expect(
      findAllergyConflicts("I have celiac disease", dish("gluten")),
    ).toHaveLength(1);
    expect(
      findAllergyConflicts("my son cannot eat rye bread", dish("wheat")),
    ).toHaveLength(1);
  });
  it.each(["macadamia", "macadamias", "brazil"])(
    "%s conflicts with nuts, tree nuts and peanuts",
    (w) => {
      expect(findAllergyConflicts(w, dish("tree nuts")), w).toHaveLength(1);
      expect(findAllergyConflicts("nuts", dish(w)), w).toHaveLength(1);
      expect(findAllergyConflicts(w, dish("peanuts")), w).toHaveLength(1);
    },
  );
  it("soybean and soybeans conflict with soy and soya", () => {
    for (const w of ["soybean", "soybeans"]) {
      expect(findAllergyConflicts(w, dish("soy"))).toHaveLength(1);
      expect(findAllergyConflicts("soya", dish(w))).toHaveLength(1);
    }
  });
  it("does not warn on unrelated grains and seeds", () => {
    expect(findAllergyConflicts("rice", dish("gluten"))).toEqual([]);
    expect(findAllergyConflicts("buckwheat", dish("gluten"))).toEqual([]);
    expect(findAllergyConflicts("coconut", dish("tree nuts"))).toEqual([]);
    expect(findAllergyConflicts("corn", dish("wheat"))).toEqual([]);
  });
});
