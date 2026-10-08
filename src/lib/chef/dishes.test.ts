import { describe, expect, it } from "vitest";
import { ApiClientError } from "@/lib/api/client";
import type { Dish } from "@/lib/api/types";
import {
  buildDishBody,
  describeDishError,
  dishPhotoUrl,
  dishToForm,
  eatByText,
  emptyDishForm,
  formFieldErrors,
  formatMinutes,
  COST_MESSAGE,
} from "@/lib/chef/dishes";

const valid = () => ({
  ...emptyDishForm(),
  name: "Pho bo",
  cuisine: "Vietnamese",
  cookMinutes: "180",
  cost: "25.50",
  servings: "4",
  shelfLifeDays: "2",
});

describe("buildDishBody", () => {
  it("converts dollars to cents and picks the allergens", () => {
    const r = buildDishBody(
      { ...valid(), allergens: ["soy"], otherAllergens: "Celery, soy" },
      { mode: "create" },
    );
    expect(r.errors).toEqual({});
    expect(r.body).toMatchObject({
      name: "Pho bo",
      cookMinutes: 180,
      ingredientCostCents: 2550,
      servings: 4,
      shelfLifeDays: 2,
      allergens: ["soy", "celery"],
    });
    expect(r.body).not.toHaveProperty("photoPath");
  });
  it("includes photoPath only when a new photo was uploaded", () => {
    const p = "u/dish-11111111-1111-4111-8111-111111111111.png";
    expect(
      buildDishBody(valid(), { mode: "update", photoPath: p }).body?.photoPath,
    ).toBe(p);
  });
  it("reports the shared bounds with the shared messages", () => {
    const r = buildDishBody(
      {
        ...valid(),
        name: " ",
        cookMinutes: "4",
        servings: "51",
        shelfLifeDays: "8",
      },
      { mode: "create" },
    );
    expect(Object.keys(r.errors).sort()).toEqual(
      ["cookMinutes", "name", "servings", "shelfLifeDays"].sort(),
    );
    expect(r.errors.cookMinutes).toMatch(/5 to 360/);
  });
  it("accepts the boundaries 5, 360, 1, 50, 0, 7", () => {
    for (const [c, s, d] of [
      ["5", "1", "0"],
      ["360", "50", "7"],
    ])
      expect(
        buildDishBody(
          { ...valid(), cookMinutes: c, servings: s, shelfLifeDays: d },
          { mode: "create" },
        ).errors,
      ).toEqual({});
  });
  it("rejects fractions, signs and words for whole-number fields", () => {
    for (const bad of ["1.5", "-3", "ten", "", "1e2"])
      expect(
        buildDishBody({ ...valid(), cookMinutes: bad }, { mode: "create" })
          .errors.cookMinutes,
      ).toBeTruthy();
  });
  it("explains cost problems in dollars", () => {
    for (const bad of ["abc", "500.01", "-1", "1.234"]) {
      expect(
        buildDishBody({ ...valid(), cost: bad }, { mode: "create" }).errors
          .ingredientCostCents,
      ).toBe(COST_MESSAGE);
    }
    expect(
      buildDishBody({ ...valid(), cost: "500" }, { mode: "create" }).errors,
    ).toEqual({});
  });
  it("rejects control characters in free text", () => {
    const r = buildDishBody(
      {
        ...valid(),
        name: "Pho\u0000",
        description: "a\u0007b",
        otherAllergens: "x\u0001",
      },
      { mode: "create" },
    );
    expect(r.errors.name).toMatch(/control/i);
    expect(r.errors.description).toBeTruthy();
    expect(r.errors.allergens).toBeTruthy();
  });
  it("allows several lines in the description but not more than 1000 characters", () => {
    expect(
      buildDishBody({ ...valid(), description: "a\nb" }, { mode: "create" })
        .errors,
    ).toEqual({});
    expect(
      buildDishBody(
        { ...valid(), description: "x".repeat(1001) },
        { mode: "create" },
      ).errors.description,
    ).toBeTruthy();
  });
  it("refuses more than 14 allergens", () => {
    const many = Array.from({ length: 15 }, (_, i) => `a${i}`).join(",");
    expect(
      buildDishBody({ ...valid(), otherAllergens: many }, { mode: "create" })
        .errors.allergens,
    ).toMatch(/14/);
  });
});

describe("dishToForm", () => {
  it("splits picker allergens from other allergens and shows dollars", () => {
    const d = {
      name: "Pad thai",
      cuisine: "Thai",
      description: null,
      cookMinutes: 90,
      ingredientCostCents: 1800,
      servings: 2,
      shelfLifeDays: 3,
      allergens: ["peanuts", "celery"],
    } as Dish;
    expect(dishToForm(d)).toMatchObject({
      description: "",
      cost: "18.00",
      allergens: ["peanuts"],
      otherAllergens: "celery",
    });
  });
});

describe("messages and formats", () => {
  it("maps the cents field error to dollars", () => {
    expect(
      formFieldErrors({
        ingredientCostCents: "Enter a whole number of cents",
        name: "x",
      }),
    ).toEqual({ ingredientCostCents: COST_MESSAGE, name: "x" });
  });
  it("shows the 50 dish cap message on 409", () => {
    expect(
      describeDishError(new ApiClientError(409, "INVALID_STATE", "cap")),
    ).toMatch(/50 active dishes/);
  });
  it("formats minutes, eat-by and photo URLs", () => {
    expect(formatMinutes(180)).toBe("3 h");
    expect(formatMinutes(95)).toBe("1 h 35 min");
    expect(formatMinutes(45)).toBe("45 min");
    expect(eatByText(0)).toMatch(/same day/);
    expect(eatByText(1)).toBe("Eat within 1 day of cooking");
    expect(eatByText(2)).toBe("Eat within 2 days of cooking");
    expect(dishPhotoUrl(null, "http://x")).toBeNull();
    expect(dishPhotoUrl("a/dish-b.png", undefined)).toBeNull();
    expect(dishPhotoUrl("a/dish-b.png", "http://x/")).toBe(
      "http://x/storage/v1/object/public/dish-photos/a/dish-b.png",
    );
  });
});
