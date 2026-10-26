// T-126 v2: the three demo pots on the home page must match the seed data, so the card can never
// show a dish, cook, city or cooking time that does not exist. Everything here is made up (demo).
import { describe, expect, it } from "vitest";
import { chefs } from "../../../scripts/seed-data";
import { cookTimeText, DEMO_POTS, potLabel } from "./demo-pots";

describe("demo pots", () => {
  it("pots match the seed", () => {
    for (const p of DEMO_POTS) {
      const chef = chefs.find((c) => c.displayName === p.chefName);
      expect(chef, p.chefName).toBeDefined();
      expect(chef!.status).toBe("approved");
      expect(chef!.kitchen?.city).toBe(p.city);
      expect(chef!.cuisines).toContain(p.cuisine);
      const dish = chef!.dishes.find((d) => d.name === p.seedDishName);
      expect(dish, p.seedDishName).toBeDefined();
      expect(dish!.cookMinutes).toBe(p.cookMinutes);
    }
  });

  it("the three pots", () => {
    expect(DEMO_POTS.map((p) => p.key)).toEqual([
      "mississauga",
      "brampton",
      "toronto",
    ]);
    expect(DEMO_POTS.map((p) => p.dishName)).toEqual([
      "Pho bo",
      "Chole and roti",
      "Brown stew fish",
    ]);
    expect(DEMO_POTS.map((p) => p.chefName)).toEqual([
      "Chef Lan (demo)",
      "Chef Harpreet (demo)",
      "Chef Devon (demo)",
    ]);
  });

  it("cookTimeText", () => {
    expect(cookTimeText(240)).toBe("about 4 h");
    expect(cookTimeText(90)).toBe("about 1.5 h");
    expect(cookTimeText(70)).toBe("about 1 h 10 min");
    expect(cookTimeText(45)).toBe("about 45 min");
  });

  it("potLabel", () => {
    expect(potLabel(DEMO_POTS[0])).toBe("Pho bo by Chef Lan (demo)");
  });
});
