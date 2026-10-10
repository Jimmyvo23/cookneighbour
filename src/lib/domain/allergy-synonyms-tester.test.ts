// T-061 Tester round: D-24 / D-30 synonym map, every group both ways, false positives kept out.
import { describe, expect, it } from "vitest";
import { SYNONYM_GROUPS, findAllergyConflicts } from "./allergy";

const dish = (allergen: string) => [
  { id: "x", name: "X", allergens: [allergen] },
];
const hit = (intake: string, allergen: string) =>
  findAllergyConflicts(intake, dish(allergen)).length === 1;

describe("T-061 tester: every synonym group matches in both directions", () => {
  SYNONYM_GROUPS.forEach((group, gi) => {
    for (const a of group)
      for (const b of group)
        it(`group ${gi}: ${a} <-> ${b}`, () => {
          expect(hit(a, b), `${a} -> ${b}`).toBe(true);
          expect(hit(b, a), `${b} -> ${a}`).toBe(true);
          // plural of either side, and inside a sentence
          expect(hit(`${a}s`, b), `${a}s -> ${b}`).toBe(true);
          expect(hit(`severe ${a} allergy`, b), `sentence ${a} -> ${b}`).toBe(
            true,
          );
        });
  });
  it("the D-24 pairs and the D-30 extra words are all present", () => {
    const flat = new Set(SYNONYM_GROUPS.flat());
    for (const w of [
      "gluten",
      "wheat",
      "dairy",
      "lactose",
      "milk",
      "shellfish",
      "shrimp",
      "crustacean",
      "nut",
      "peanut",
      "soy",
      "soya",
      "mollusk",
      "mollusc",
      "sulfite",
      "sulphite",
      "prawn",
      "crab",
      "lobster",
      "clam",
      "squid",
      "oyster",
      "mussel",
      "scallop",
      "almond",
      "cashew",
      "walnut",
      "pecan",
      "pistachio",
      "hazelnut",
      "groundnut",
    ])
      expect(flat.has(w), w).toBe(true);
  });
});

describe("T-061 tester: false positives stay out", () => {
  const no: [string, string][] = [
    ["fish", "shellfish"],
    ["shellfish", "fish"],
    ["fish", "crustaceans"],
    ["fish", "molluscs"],
    ["eggs", "milk"],
    ["egg", "dairy"],
    ["milk", "eggs"],
    ["sesame", "soy"],
    ["soy", "sesame"],
    ["nutmeg", "tree nuts"],
    ["nutmeg", "peanuts"],
    ["nuts", "nutmeg"],
    ["wheat", "buckwheat"],
    ["mustard", "wheat"],
    ["gluten", "milk"],
    ["milk", "soy"],
    ["shrimp", "clams"],
    ["sulfite", "soy"],
    ["butternut squash", "tree nuts"],
  ];
  it.each(no)("intake %j does not hit allergen %j", (a, b) => {
    // shrimp and clams are only linked through the word "shellfish", not to each other.
    expect(hit(a, b), `${a} -> ${b}`).toBe(false);
  });
});

describe("T-061 tester: words outside the map (reported, not decided)", () => {
  it("coconut and buckwheat: current behaviour", () => {
    // Coconut is not in any group: it matches only the word 'coconut' itself.
    expect(hit("coconut", "tree nuts")).toBe(false);
    expect(hit("tree nuts", "coconut")).toBe(false);
    expect(hit("coconut", "coconut")).toBe(true);
    // Buckwheat is a different word from wheat/gluten.
    expect(hit("buckwheat", "wheat")).toBe(false);
    expect(hit("buckwheat", "gluten")).toBe(false);
    expect(hit("wheat", "buckwheat")).toBe(false);
    expect(hit("buckwheat", "buckwheat")).toBe(true);
  });
});
