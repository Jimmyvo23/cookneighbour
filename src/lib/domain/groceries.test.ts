import { describe, expect, it } from "vitest";
import { estimateBooking } from "./pricing.ts";
import {
  buildShoppingList,
  groceryPlan,
  parseReceiptAnswer,
  parseReceiptBody,
  receiptPathError,
  RECEIPT_MAX_CENTS,
} from "./groceries.ts";

const B = "11111111-1111-4111-8111-111111111111";

describe("buildShoppingList", () => {
  it("sums cost x quantity per line, day and booking", () => {
    const l = buildShoppingList([
      {
        dayNumber: 1,
        date: "2026-10-20",
        dishes: [
          {
            name: "Pho",
            quantity: 2,
            servings: 4,
            ingredientCostCents: 2500,
            allergens: ["soy"],
          },
          {
            name: "Rolls",
            quantity: 1,
            servings: 6,
            ingredientCostCents: 1200,
            allergens: [],
          },
        ],
      },
      { dayNumber: 2, date: "2026-10-21", dishes: [] },
    ]);
    expect(l.days[0].dishes[0].lineCostCents).toBe(5000);
    expect(l.days[0].estimatedCostCents).toBe(6200);
    expect(l.days[1].estimatedCostCents).toBe(0);
    expect(l.estimatedCostCents).toBe(6200);
  });
  it("matches the booking estimate from pricing.ts", () => {
    const dishes = [
      { cookMinutes: 60, ingredientCostCents: 2500, quantity: 2 },
      { cookMinutes: 30, ingredientCostCents: 999, quantity: 3 },
    ];
    const est = estimateBooking({
      hourlyRateCents: 2000,
      locationType: "chef_home",
      days: [{ dishes }],
      isFreeTrial: false,
    });
    const l = buildShoppingList([
      {
        dayNumber: 1,
        date: "2026-10-20",
        dishes: dishes.map((d, i) => ({
          name: `d${i}`,
          quantity: d.quantity,
          servings: 2,
          ingredientCostCents: d.ingredientCostCents,
          allergens: [],
        })),
      },
    ]);
    expect(l.estimatedCostCents).toBe(est.ingredientsCents);
  });
});

describe("groceryPlan", () => {
  it("option A at the chef's home: the customer delivers to the chef", () => {
    const p = groceryPlan("customer_buys", "chef_home");
    expect(p.customerDeliversToChef).toBe(true);
    expect(p.deliverTo).toBe("chef_home");
    expect(p.receiptRequired).toBe(false);
  });
  it("option A at the customer's home: nothing to deliver", () => {
    const p = groceryPlan("customer_buys", "customer_home");
    expect(p.customerDeliversToChef).toBe(false);
    expect(p.deliverTo).toBe("customer_home");
  });
  it("option B needs a receipt, at cost, MOCK", () => {
    const p = groceryPlan("chef_shops", "customer_home");
    expect(p.buyer).toBe("chef");
    expect(p.receiptRequired).toBe(true);
    expect(p.note).toMatch(/at cost/);
    expect(p.note).toMatch(/MOCK/);
  });
});

describe("receiptPathError", () => {
  it("accepts <booking id>/<name>.png|jpg|pdf", () => {
    expect(receiptPathError(B, `${B}/r-1.png`)).toBeNull();
    expect(receiptPathError(B, `${B}/Receipt.PDF`)).toBeNull();
  });
  it.each([
    "",
    `${B}`,
    `${B}/`,
    `${B}/../x.png`,
    `${B}/a/b.png`,
    `/${B}/a.png`,
    `${B}\\a.png`,
    `${B}/a.png\u0000`,
    `${B}/a.gif`,
    `${B}/noext`,
    `${B}/.hidden.png`,
    `22222222-2222-4222-8222-222222222222/a.png`,
    `${B}/a b.png`,
  ])("refuses %j", (p) => {
    expect(receiptPathError(B, p)).not.toBeNull();
  });
  it("refuses non-strings", () => {
    expect(receiptPathError(B, 5)).not.toBeNull();
    expect(receiptPathError(B, undefined)).not.toBeNull();
  });
});

describe("parseReceiptBody", () => {
  it("accepts a valid body", () => {
    expect(
      parseReceiptBody(B, { filePath: `${B}/a.png`, amountCents: 4321 }),
    ).toEqual({
      value: { filePath: `${B}/a.png`, amountCents: 4321 },
    });
  });
  it.each([0, -1, 1.5, "10", null, NaN, RECEIPT_MAX_CENTS + 1])(
    "refuses amount %j",
    (a) => {
      const r = parseReceiptBody(B, { filePath: `${B}/a.png`, amountCents: a });
      expect("fields" in r && r.fields.amountCents).toBeTruthy();
    },
  );
  it("reports every bad field together", () => {
    const r = parseReceiptBody(B, {});
    expect("fields" in r && Object.keys(r.fields).sort()).toEqual([
      "amountCents",
      "filePath",
    ]);
  });
});

describe("parseReceiptAnswer", () => {
  it("confirm needs no note", () => {
    expect(parseReceiptAnswer({ action: "confirm" })).toEqual({
      value: { action: "confirm", note: null },
    });
  });
  it("confirm refuses a note", () => {
    expect(
      "fields" in parseReceiptAnswer({ action: "confirm", note: "hi" }),
    ).toBe(true);
  });
  it("dispute needs 3 to 300 safe characters", () => {
    expect("fields" in parseReceiptAnswer({ action: "dispute" })).toBe(true);
    expect(
      "fields" in parseReceiptAnswer({ action: "dispute", note: "ab" }),
    ).toBe(true);
    expect(
      "fields" in
        parseReceiptAnswer({ action: "dispute", note: "x".repeat(301) }),
    ).toBe(true);
    expect(
      "fields" in parseReceiptAnswer({ action: "dispute", note: "bad\u0000" }),
    ).toBe(true);
    expect(
      parseReceiptAnswer({ action: "dispute", note: "  Wrong total  " }),
    ).toEqual({
      value: { action: "dispute", note: "Wrong total" },
    });
  });
  it("refuses an unknown action", () => {
    expect("fields" in parseReceiptAnswer({ action: "pay" })).toBe(true);
  });
});
