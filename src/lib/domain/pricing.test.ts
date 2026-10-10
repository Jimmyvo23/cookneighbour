import { describe, expect, it } from "vitest";
import { estimateBooking, type EstimateInput } from "./pricing";
import { checkVisitLimits } from "./visitLimit";
import {
  PLATFORM_FEE_PERCENT,
  TRAVEL_RATE_CENTS_PER_KM,
  VISIT_SOFT_LIMIT_MINUTES,
} from "./config";
import { divRoundHalfUp, percentOf } from "./money";

const dish = (cookMinutes: number, ingredientCostCents = 0, quantity = 1) => ({
  cookMinutes,
  ingredientCostCents,
  quantity,
});
const base = (over: Partial<EstimateInput> = {}): EstimateInput => ({
  hourlyRateCents: 3000,
  locationType: "customer_home",
  isFreeTrial: false,
  distanceMetres: 10000,
  days: [{ dishes: [dish(90, 2000), dish(30, 1000)] }],
  ...over,
});

describe("rounding rule (documented): integer cents, halves round up", () => {
  it("divRoundHalfUp", () => {
    expect(divRoundHalfUp(1, 2)).toBe(1);
    expect(divRoundHalfUp(0, 7)).toBe(0);
    expect(divRoundHalfUp(5, 3)).toBe(2);
    expect(divRoundHalfUp(4, 3)).toBe(1);
    expect(() => divRoundHalfUp(1.5, 2)).toThrow(RangeError);
    expect(() => divRoundHalfUp(-1, 2)).toThrow(RangeError);
    expect(() => divRoundHalfUp(1, 0)).toThrow(RangeError);
  });
  it("percentOf", () => {
    expect(percentOf(4500, 10)).toBe(450);
    expect(percentOf(4505, 10)).toBe(451); // 450.5 rounds up
    expect(percentOf(4504, 10)).toBe(450);
    expect(percentOf(1000, 12.5)).toBe(125);
    expect(percentOf(0, 10)).toBe(0);
    expect(() => percentOf(100, -1)).toThrow(RangeError);
    expect(() => percentOf(10.5, 10)).toThrow(RangeError);
  });
});

describe("estimateBooking", () => {
  it("sums cook time, labour = minutes x rate, ingredients, travel, platform fee", () => {
    const e = estimateBooking(base());
    expect(e.cookMinutes).toBe(120);
    expect(e.labourCents).toBe(6000);
    expect(e.ingredientsCents).toBe(3000);
    expect(e.travelCents).toBe(600); // 10 km x 60 cents
    expect(e.platformFeePercent).toBe(PLATFORM_FEE_PERCENT);
    expect(e.platformFeeCents).toBe(600); // 10% of 6000
    expect(e.totalCents).toBe(6000 + 3000 + 600);
    expect(e.currency).toBe("CAD");
    expect(e.platformFeeCollected).toBe(false);
    expect(e.days).toHaveLength(1);
    expect(e.days[0].cookMinutes).toBe(120);
  });

  it("uses quantities for time and ingredient cost", () => {
    const e = estimateBooking(base({ days: [{ dishes: [dish(40, 500, 3)] }] }));
    expect(e.cookMinutes).toBe(120);
    expect(e.ingredientsCents).toBe(1500);
    expect(e.labourCents).toBe(6000);
  });

  it("rounds labour half up and keeps the total equal to the sum of its parts", () => {
    const e = estimateBooking(
      base({ hourlyRateCents: 3001, days: [{ dishes: [dish(30)] }] }),
    ); // 1500.5
    expect(e.labourCents).toBe(1501);
    const f = estimateBooking(
      base({ hourlyRateCents: 2999, days: [{ dishes: [dish(100)] }] }),
    ); // 4998.33
    expect(f.labourCents).toBe(4998);
  });

  it("travel fee rounds half up from whole metres and repeats for every visit day", () => {
    const one = estimateBooking(base({ distanceMetres: 25 })); // 1.5 cents
    expect(one.travelCents).toBe(2);
    const e = estimateBooking(
      base({
        distanceMetres: 12345,
        days: [{ dishes: [dish(60)] }, { dishes: [dish(60)] }],
      }),
    );
    expect(e.days.map((d) => d.travelCents)).toEqual([741, 741]);
    expect(e.travelCents).toBe(1482);
    expect(TRAVEL_RATE_CENTS_PER_KM).toBe(60);
  });

  it("chef's home has no travel fee, whatever distance is passed", () => {
    const e = estimateBooking(
      base({ locationType: "chef_home", distanceMetres: 30000 }),
    );
    expect(e.travelCents).toBe(0);
    expect(e.days[0].travelCents).toBe(0);
    expect(
      estimateBooking(base({ locationType: "chef_home", distanceMetres: null }))
        .travelCents,
    ).toBe(0);
  });

  it("customer's home needs a distance", () => {
    expect(() => estimateBooking(base({ distanceMetres: null }))).toThrow(
      RangeError,
    );
    expect(() => estimateBooking(base({ distanceMetres: -1 }))).toThrow(
      RangeError,
    );
  });

  it("free trial waives labour only: ingredients and travel are still paid", () => {
    const e = estimateBooking(base({ isFreeTrial: true }));
    expect(e.labourBeforeWaiverCents).toBe(6000);
    expect(e.freeTrialWaivedCents).toBe(6000);
    expect(e.labourCents).toBe(0);
    expect(e.platformFeeCents).toBe(0);
    expect(e.ingredientsCents).toBe(3000);
    expect(e.travelCents).toBe(600);
    expect(e.totalCents).toBe(3600);
  });

  it("free trial at the chef's home pays ingredients only", () => {
    const e = estimateBooking(
      base({ isFreeTrial: true, locationType: "chef_home" }),
    );
    expect(e.totalCents).toBe(3000);
  });

  it("warns for every day over the 6 hour soft limit and flags the estimate", () => {
    const e = estimateBooking(
      base({
        days: [
          { dishes: [dish(200), dish(160)] }, // 360, exactly the limit
          { dishes: [dish(200), dish(161)] }, // 361
          { dishes: [dish(360), dish(5)] }, // 365
        ],
      }),
    );
    expect(e.exceedsSoftLimit).toBe(true);
    expect(e.warnings).toEqual([
      {
        code: "VISIT_OVER_SOFT_LIMIT",
        dayIndex: 1,
        minutes: 361,
        overByMinutes: 1,
      },
      {
        code: "VISIT_OVER_SOFT_LIMIT",
        dayIndex: 2,
        minutes: 365,
        overByMinutes: 5,
      },
    ]);
  });

  it("a day exactly at the limit is fine", () => {
    const e = estimateBooking(base({ days: [{ dishes: [dish(360)] }] }));
    expect(e.exceedsSoftLimit).toBe(false);
    expect(e.warnings).toEqual([]);
  });

  it("accepts overrides for the configurable constants", () => {
    const e = estimateBooking(
      base({ platformFeePercent: 20, travelRateCentsPerKm: 100 }),
    );
    expect(e.platformFeeCents).toBe(1200);
    expect(e.travelCents).toBe(1000);
  });

  it("rejects non-integer or negative money and empty days", () => {
    expect(() => estimateBooking(base({ hourlyRateCents: 30.5 }))).toThrow();
    expect(() => estimateBooking(base({ hourlyRateCents: 0 }))).toThrow();
    expect(() =>
      estimateBooking(base({ days: [{ dishes: [dish(10, -1)] }] })),
    ).toThrow();
    expect(() =>
      estimateBooking(base({ days: [{ dishes: [dish(10, 0, 0)] }] })),
    ).toThrow();
    expect(() => estimateBooking(base({ days: [] }))).toThrow();
  });

  describe("property: money is always a non-negative integer and sums exactly", () => {
    // Small deterministic PRNG so failures are reproducible (no extra dependency).
    let seed = 20261008;
    const rnd = (n: number) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return Math.floor((seed / 4294967296) * n);
    };
    it("holds for 500 random bookings", () => {
      for (let i = 0; i < 500; i++) {
        const input: EstimateInput = {
          hourlyRateCents: 1 + rnd(20000),
          locationType: rnd(2) ? "customer_home" : "chef_home",
          isFreeTrial: rnd(2) === 1,
          distanceMetres: rnd(200000),
          platformFeePercent: rnd(3001) / 100,
          days: Array.from({ length: 1 + rnd(3) }, () => ({
            dishes: Array.from({ length: 1 + rnd(4) }, () =>
              dish(5 + rnd(356), rnd(50001), 1 + rnd(10)),
            ),
          })),
        };
        const e = estimateBooking(input);
        const all = [
          e.cookMinutes,
          e.labourCents,
          e.ingredientsCents,
          e.travelCents,
          e.platformFeeCents,
          e.totalCents,
          e.labourBeforeWaiverCents,
          e.freeTrialWaivedCents,
          ...e.days.flatMap((d) => [
            d.cookMinutes,
            d.labourCents,
            d.ingredientsCents,
            d.travelCents,
            d.platformFeeCents,
          ]),
        ];
        for (const n of all) {
          expect(Number.isInteger(n)).toBe(true);
          expect(n).toBeGreaterThanOrEqual(0);
        }
        expect(e.totalCents).toBe(
          e.labourCents + e.ingredientsCents + e.travelCents,
        );
        for (const k of [
          "cookMinutes",
          "labourCents",
          "ingredientsCents",
          "travelCents",
          "platformFeeCents",
        ] as const)
          expect(e[k]).toBe(e.days.reduce((s, d) => s + d[k], 0));
        expect(e.labourBeforeWaiverCents - e.freeTrialWaivedCents).toBe(
          e.labourCents,
        );
        if (input.locationType === "chef_home") expect(e.travelCents).toBe(0);
        if (input.isFreeTrial) expect(e.labourCents).toBe(0);
      }
    });
  });
});

describe("checkVisitLimits", () => {
  it("returns one warning per day over the limit", () => {
    expect(checkVisitLimits([360, 361, 10, 600])).toEqual([
      {
        code: "VISIT_OVER_SOFT_LIMIT",
        dayIndex: 1,
        minutes: 361,
        overByMinutes: 1,
      },
      {
        code: "VISIT_OVER_SOFT_LIMIT",
        dayIndex: 3,
        minutes: 600,
        overByMinutes: 240,
      },
    ]);
    expect(checkVisitLimits([])).toEqual([]);
  });
  it("limit is configurable", () => {
    expect(checkVisitLimits([100], 90)).toHaveLength(1);
    expect(VISIT_SOFT_LIMIT_MINUTES).toBe(360);
  });
});
