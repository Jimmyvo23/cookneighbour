// Tester gap tests for T-037 (independent oracles, boundaries, helpers). Tests only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chefs, customers } from "../../../scripts/seed-data";
import { parsePostalPrefixes } from "../../../scripts/seed-lib";
import { normalizePhone } from "./phone";
import { normalizePostalCode } from "./address";
import { estimateBooking } from "./pricing";
import { checkReceipt } from "./receipt";
import {
  cancellationTiming,
  freeTrialEffect,
  type FreeTrialEvent,
} from "./cancellation";
import { eatByDate } from "./eatBy";
import { chefMatchesDietary } from "./dietary";
import { divRoundHalfUp } from "./money";
import { ALLERGENS_RAW_MAX, parseDishBody } from "./dishes";
import { MAX_DISH_QUANTITY } from "./config";
import { haversineKm, distanceMetres } from "./distance";
import {
  validateBooking,
  type BookingChef,
  type BookingRequest,
} from "./bookingValidation";

const dish = (m: number, c: number, q = 1) => ({
  cookMinutes: m,
  ingredientCostCents: c,
  quantity: q,
});

describe("A-13 / A-14 pricing oracle", () => {
  it("travel: rounded once per day, repeated per visit day", () => {
    const e = estimateBooking({
      hourlyRateCents: 3000,
      locationType: "customer_home",
      isFreeTrial: false,
      distanceMetres: 1234,
      days: [
        { dishes: [dish(60, 0)] },
        { dishes: [dish(60, 0)] },
        { dishes: [dish(60, 0)] },
      ],
    });
    expect(e.days.map((d) => d.travelCents)).toEqual([74, 74, 74]); // 74.04 -> 74
    expect(e.travelCents).toBe(222);
  });
  it("travel half-up: 0.5 cent rounds up (distance 25 m at 60c/km = 1.5)", () => {
    const e = estimateBooking({
      hourlyRateCents: 100,
      locationType: "customer_home",
      isFreeTrial: false,
      distanceMetres: 25,
      days: [{ dishes: [dish(5, 0)] }],
    });
    expect(e.travelCents).toBe(2);
  });
  it("fractional km distance is refused (whole metres only)", () => {
    expect(() =>
      estimateBooking({
        hourlyRateCents: 100,
        locationType: "customer_home",
        isFreeTrial: false,
        distanceMetres: 1234.5,
        days: [{ dishes: [dish(5, 0)] }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      estimateBooking({
        hourlyRateCents: 100,
        locationType: "customer_home",
        isFreeTrial: false,
        distanceMetres: 0,
        days: [{ dishes: [dish(5, 0)] }],
      }),
    ).not.toThrow();
  });
  it("platform fee: labour only, half-up per day, never added to total, 0 on free trial", () => {
    // 5 min at 6000c/h = 500c labour; 10% = 50
    const paid = estimateBooking({
      hourlyRateCents: 6000,
      locationType: "chef_home",
      isFreeTrial: false,
      days: [{ dishes: [dish(5, 9999)] }],
    });
    expect(paid.labourCents).toBe(500);
    expect(paid.platformFeeCents).toBe(50);
    expect(paid.totalCents).toBe(500 + 9999);
    expect(paid.platformFeeCollected).toBe(false);
    // 5 min at 6c/h?? labour = round(30/60)=1 cent -> fee 0.1 -> 0 ; labour 5c -> 0.5 -> 1
    const tiny = estimateBooking({
      hourlyRateCents: 60,
      locationType: "chef_home",
      isFreeTrial: false,
      days: [{ dishes: [dish(5, 0)] }],
    });
    expect(tiny.labourCents).toBe(5);
    expect(tiny.platformFeeCents).toBe(1);
    const free = estimateBooking({
      hourlyRateCents: 6000,
      locationType: "customer_home",
      distanceMetres: 5000,
      isFreeTrial: true,
      days: [{ dishes: [dish(120, 1000)] }],
    });
    expect(free.labourCents).toBe(0);
    expect(free.platformFeeCents).toBe(0);
    expect(free.freeTrialWaivedCents).toBe(12000);
    expect(free.totalCents).toBe(1000 + 300);
  });
  it("fee is rounded per day, not on the sum", () => {
    // each day labour 5c -> fee 1 (half up); three days -> 3, not round(1.5)=2
    const e = estimateBooking({
      hourlyRateCents: 60,
      locationType: "chef_home",
      isFreeTrial: false,
      days: [0, 1, 2].map(() => ({ dishes: [dish(5, 0)] })),
    });
    expect(e.platformFeeCents).toBe(3);
  });
  it("huge values throw instead of leaking floats; zero rate refused", () => {
    expect(() =>
      estimateBooking({
        hourlyRateCents: Number.MAX_SAFE_INTEGER,
        locationType: "chef_home",
        isFreeTrial: false,
        days: [{ dishes: [dish(360, 0)] }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      estimateBooking({
        hourlyRateCents: 0,
        locationType: "chef_home",
        isFreeTrial: false,
        days: [{ dishes: [dish(5, 0)] }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      estimateBooking({
        hourlyRateCents: 3000.5,
        locationType: "chef_home",
        isFreeTrial: false,
        days: [{ dishes: [dish(5, 0)] }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      estimateBooking({
        hourlyRateCents: NaN,
        locationType: "chef_home",
        isFreeTrial: false,
        days: [{ dishes: [dish(5, 0)] }],
      }),
    ).toThrow(RangeError);
  });
  it("property: BigInt oracle for 400 random bookings", () => {
    let seed = 987654321;
    const rnd = (n: number) => (
      (seed = (seed * 1103515245 + 12345) % 2147483648),
      seed % n
    );
    const half = (n: bigint, d: bigint) => (2n * n + d) / (2n * d);
    for (let i = 0; i < 400; i++) {
      const rate = 1 + rnd(50000),
        metres = rnd(60000),
        nd = 1 + rnd(3),
        free = rnd(4) === 0,
        home = rnd(2) === 0;
      const days = Array.from({ length: nd }, () => ({
        dishes: Array.from({ length: 1 + rnd(3) }, () =>
          dish(5 + rnd(356), rnd(20000), 1 + rnd(5)),
        ),
      }));
      const e = estimateBooking({
        hourlyRateCents: rate,
        locationType: home ? "customer_home" : "chef_home",
        isFreeTrial: free,
        distanceMetres: metres,
        days,
      });
      let lab = 0n,
        ing = 0n,
        trv = 0n,
        fee = 0n;
      for (const d of days) {
        const min = BigInt(
          d.dishes.reduce((s, x) => s + x.cookMinutes * x.quantity, 0),
        );
        const l = free ? 0n : half(min * BigInt(rate), 60n);
        lab += l;
        fee += half(l * 1000n, 10000n);
        ing += BigInt(
          d.dishes.reduce((s, x) => s + x.ingredientCostCents * x.quantity, 0),
        );
        if (home) trv += half(BigInt(metres) * 60n, 1000n);
      }
      expect([
        e.labourCents,
        e.ingredientsCents,
        e.travelCents,
        e.platformFeeCents,
      ]).toEqual([Number(lab), Number(ing), Number(trv), Number(fee)]);
      expect(e.totalCents).toBe(Number(lab + ing + trv));
      for (const v of [
        e.totalCents,
        e.labourCents,
        e.travelCents,
        e.platformFeeCents,
      ])
        expect(Number.isInteger(v)).toBe(true);
    }
  });
  it("divRoundHalfUp edge cases", () => {
    expect(divRoundHalfUp(1, 2)).toBe(1);
    expect(divRoundHalfUp(0, 7)).toBe(0);
    expect(divRoundHalfUp(2, 3)).toBe(1);
    expect(divRoundHalfUp(1, 3)).toBe(0);
    expect(() => divRoundHalfUp(1, 0)).toThrow();
    expect(() => divRoundHalfUp(-1, 2)).toThrow();
  });
});

describe("A-15 receipt boundary", () => {
  it.each([
    [10000, 1500, false],
    [10000, 1501, true],
    [10000, -1500, false],
    [10000, -1501, true],
    [0, 500, false],
    [0, 501, true],
    [3333, 500, false],
    [3333, 501, true],
    [3400, 510, false],
    [3400, 511, true],
    [100000, 15000, false],
    [100000, 15001, true],
  ])("estimate %i, difference %i -> mismatch %s", (est, diff, mismatch) => {
    expect(checkReceipt(est, est + diff).mismatch).toBe(mismatch);
  });
});

describe("A-6 cancellation boundaries", () => {
  const at = (iso: string, first: string) =>
    cancellationTiming({
      now: new Date(iso),
      firstVisitDate: first,
      cancelledBy: "customer",
    }).timing;
  it("exact second, summer (EDT): 2026-07-10 starts 04:00Z, deadline 07-08T04:00Z", () => {
    expect(at("2026-07-08T04:00:00Z", "2026-07-10")).toBe("on_time");
    expect(at("2026-07-08T04:00:01Z", "2026-07-10")).toBe("late");
    expect(at("2026-07-08T03:59:59Z", "2026-07-10")).toBe("on_time");
  });
  it("spring forward: day 1 = 2026-03-09 (EDT), deadline = 03-07T04:00Z", () => {
    expect(at("2026-03-07T04:00:00Z", "2026-03-09")).toBe("on_time");
    expect(at("2026-03-07T04:00:01Z", "2026-03-09")).toBe("late");
  });
  it("day 1 = the change day 2026-03-08 (EST midnight 05:00Z), deadline 03-06T05:00Z", () => {
    expect(at("2026-03-06T05:00:00Z", "2026-03-08")).toBe("on_time");
    expect(at("2026-03-06T05:00:01Z", "2026-03-08")).toBe("late");
  });
  it("fall back: day 1 = 2026-11-01 (EDT midnight 04:00Z) deadline 10-30T04:00Z; 2026-11-02 (EST) deadline 10-31T05:00Z", () => {
    expect(at("2026-10-30T04:00:00Z", "2026-11-01")).toBe("on_time");
    expect(at("2026-10-30T04:00:01Z", "2026-11-01")).toBe("late");
    expect(at("2026-10-31T05:00:00Z", "2026-11-02")).toBe("on_time");
    expect(at("2026-10-31T05:00:01Z", "2026-11-02")).toBe("late");
  });
  it("invalid dates throw; far past is late", () => {
    expect(() => at("2026-01-01T00:00:00Z", "2026-02-30")).toThrow();
    expect(() => at("2026-01-01T00:00:00Z", "nope")).toThrow();
    expect(at("2030-01-01T00:00:00Z", "2026-02-10")).toBe("late");
  });
});

describe("A-16 every free-trial outcome", () => {
  const table: Record<FreeTrialEvent, string> = {
    requested: "hold",
    accepted: "hold",
    declined: "release",
    cancelled: "release",
    completed: "consume",
    no_show_customer: "consume",
    no_show_chef: "release",
    expired: "release",
  };
  it.each(Object.entries(table))("%s -> %s", (ev, want) => {
    expect(freeTrialEffect(ev as FreeTrialEvent)).toBe(want);
  });
});

describe("A-7 eat-by across boundaries", () => {
  it.each([
    ["2026-12-31", 2, "2027-01-02"],
    ["2026-01-30", 2, "2026-02-01"],
    ["2028-02-28", 2, "2028-03-01"],
    ["2027-02-27", 2, "2027-03-01"],
    ["2026-10-31", 2, "2026-11-02"],
    ["2026-12-30", 7, "2027-01-06"],
    ["2026-05-05", 0, "2026-05-05"],
    ["2026-03-07", 2, "2026-03-09"],
    ["2026-10-31", 2, "2026-11-02"],
  ])("%s + %i = %s", (d, n, want) => expect(eatByDate(d, n)).toBe(want));
  it("rejects bad input", () => {
    expect(() => eatByDate("2026-02-29", 2)).toThrow();
    expect(() => eatByDate("2026-02-10", 8)).toThrow();
    expect(() => eatByDate("2026-02-10", -1)).toThrow();
    expect(() => eatByDate("2026-02-10", 1.5)).toThrow();
  });
});

describe("A-17 dietary matcher", () => {
  const d = (allergens: string[], isActive = true) => ({ isActive, allergens });
  it("needs a dish free of ALL selected allergens", () => {
    expect(
      chefMatchesDietary([d(["peanuts"]), d(["milk"])], ["peanuts", "milk"]),
    ).toBe(false);
    expect(
      chefMatchesDietary([d(["peanuts"]), d(["sesame"])], ["peanuts", "milk"]),
    ).toBe(true);
  });
  it("lower-case on both sides, trims, ignores blank selections, ignores inactive", () => {
    expect(chefMatchesDietary([d(["Peanuts "])], [" PEANUTS"])).toBe(false);
    expect(chefMatchesDietary([d(["peanuts"], true)], ["   "])).toBe(true);
    expect(chefMatchesDietary([d([], false)], ["peanuts"])).toBe(false);
    expect(
      chefMatchesDietary([d([], false), d(["peanuts"])], ["peanuts"]),
    ).toBe(false);
    expect(chefMatchesDietary([], ["peanuts"])).toBe(false);
  });
});

describe("phone and postal tightening", () => {
  it.each(["+14165550101", "905 201 2345", "(647) 222-3456", "1-289-999-9999"])(
    "valid phone %s",
    (p) => expect(normalizePhone(p)).not.toBeNull(),
  );
  it.each([
    "+11165550101",
    "416 155 0101",
    "911 222 3333",
    "416 911 3333",
    "416 311 0000",
    "411-411-4111",
    "0165550101",
    "416 555 01011",
    "",
    "+1 416 555 010",
  ])("invalid phone %s", (p) => expect(normalizePhone(p)).toBeNull());
  it("area code 211-like in middle: 4115550101 area 411 refused; 9115 etc", () => {
    expect(normalizePhone("4115550101")).toBeNull();
    expect(normalizePhone("2125550101")).not.toBeNull();
  });
  it.each(["L5B 1A1", "m5v-2t6", "K1A0B1", "V6B1A1", "L4K 6E6"])(
    "valid postal %s",
    (p) => expect(normalizePostalCode(p)).not.toBeNull(),
  );
  it.each([
    "W1A 1A1",
    "Z1A1A1",
    "L5D1A1",
    "L5B1F1",
    "L5B1I1",
    "L5B1O1",
    "L5B1Q1",
    "L5B1U1",
    "L5B1",
    "L5B 1A12",
    "55B1A1",
    "L5B1AA",
  ])("invalid postal %s", (p) => expect(normalizePostalCode(p)).toBeNull());
  it("W and Z are allowed in positions 2 and 3 letters", () => {
    expect(normalizePostalCode("L5W1Z1")).toBe("L5W1Z1");
  });
  it("every seed phone and postal code is valid, every prefix usable", () => {
    for (const c of customers) {
      expect(normalizePhone(c.phone)).toBe(c.phone);
      expect(normalizePostalCode(c.postalCode)).not.toBeNull();
    }
    for (const c of chefs as any[]) {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      if (c.phone) expect(normalizePhone(c.phone)).toBe(c.phone);
      for (const pc of [
        c.postalCode,
        c.kitchen?.postalCode,
        c.address?.postalCode,
        c.serviceArea?.postalCode,
      ])
        if (pc) expect(normalizePostalCode(pc)).not.toBeNull();
    }
    const src = readFileSync("scripts/seed-data.ts", "utf8");
    for (const m of src.match(/postalCode: "([^"]+)"/g) ?? [])
      expect(normalizePostalCode(m.slice(13, -1)), m).not.toBeNull();
    for (const m of src.match(/\+1[0-9]{10}/g) ?? [])
      expect(normalizePhone(m), m).toBe(m);
    for (const p of parsePostalPrefixes(
      readFileSync("supabase/seed.sql", "utf8"),
    ))
      expect(
        `${p.prefix}1A1`.match(
          /^[ABCEGHJKLMNPRSTVXY][0-9][ABCEGHJKLMNPRSTVWXYZ]/,
        ),
        p.prefix,
      ).not.toBeNull();
  });
  it("test phone helpers never produce N11 or invalid values (source of tests/api/harness newPhone mirrored)", async () => {
    const real = readFileSync("tests/api/harness.ts", "utf8");
    expect(real).toContain('"11" ? "22"');
    // mirror of the fixed helper over every two-digit prefix
    for (let k = 0; k < 100; k++) {
      const n = String(k).padStart(2, "0") + "1234";
      const two = n.slice(0, 2) === "11" ? "22" : n.slice(0, 2);
      expect(
        normalizePhone(`+16472${two}${n.slice(2)}`.slice(0, 12)),
      ).not.toBeNull();
    }
    // chef-helpers uniquePhone and e2e rnd()
    for (let i = 0; i < 20000; i++) {
      const area = ["416", "905", "437", "289"][i % 4];
      const ex = String(200 + (i % 800));
      if (ex !== "555" && !ex.endsWith("11"))
        expect(normalizePhone(`+1${area}${ex}1234`)).not.toBeNull();
    }
  });
});

describe("allergenList (via parseDishBody)", () => {
  const body = (allergens: unknown) =>
    parseDishBody(
      { name: "A", cuisine: "B", cookMinutes: 30, allergens },
      "create",
    );
  const names = Array.from({ length: 20 }, (_, i) => `a${i}`);
  it("dedupes before applying the 14 limit", () => {
    expect(
      body([...names.slice(0, 14), "A0", "a1 "]).errors.allergens,
    ).toBeUndefined();
    expect(body([...names.slice(0, 14), "A0"]).value.allergens).toHaveLength(
      14,
    );
    expect(body(names.slice(0, 15)).errors.allergens).toBeDefined();
  });
  it("raw entries cap is 50", () => {
    expect(ALLERGENS_RAW_MAX).toBe(50);
    expect(body(Array(50).fill("milk")).errors.allergens).toBeUndefined();
    expect(body(Array(51).fill("milk")).errors.allergens).toBeDefined();
  });
  it("contract wording matches", () => {
    const c = readFileSync("docs/api-contract.md", "utf8");
    expect(c).toContain("up to 14 **distinct** allergens");
    expect(c).toContain("at most 50 raw entries");
  });
});

describe("booking validation extra boundaries", () => {
  const C = { lat: 43.5934, lng: -79.6446 };
  const far = { lat: 43.6426, lng: -79.3871 };
  const centres = new Map([
    ["L5B", C],
    ["M5V", far],
  ]);
  const metres = distanceMetres(C, far);
  const mk = (over: Partial<BookingChef> = {}): BookingChef => ({
    id: "c",
    status: "approved",
    locationOptions: ["customer_home", "chef_home"],
    chefHomeEnabled: true,
    serviceRadiusKm: 30,
    serviceCentre: C,
    availableDates: new Set([
      "2026-10-08",
      "2027-04-06",
      "2027-04-07",
      "2026-10-10",
    ]),
    dishes: [
      {
        id: "d",
        chefId: "c",
        name: "D",
        isActive: true,
        cookMinutes: 360,
        ingredientCostCents: 0,
        allergens: [],
        shelfLifeDays: 2,
      },
    ],
    ...over,
  });
  const r = (
    date: string,
    over: Partial<BookingRequest> = {},
  ): BookingRequest => ({
    locationType: "chef_home",
    days: [{ date, dishes: [{ dishId: "d", quantity: 1 }] }],
    intake: { allergies: "", dietaryNotes: "" },
    ...over,
  });
  const ctx = (today = "2026-10-08") => ({
    today,
    chefBookedDates: new Set<string>(),
    centres,
  });
  const codes = (x: ReturnType<typeof validateBooking>) =>
    x.errors.map((e) => e.code);
  it("window: today ok, day 180 ok, day 181 beyond (2026-10-08 + 180 = 2027-04-06)", () => {
    expect(codes(validateBooking(r("2026-10-08"), mk(), ctx()))).toEqual([]);
    expect(codes(validateBooking(r("2027-04-06"), mk(), ctx()))).toEqual([]);
    expect(codes(validateBooking(r("2027-04-07"), mk(), ctx()))).toEqual([
      "DATE_BEYOND_WINDOW",
    ]);
    expect(codes(validateBooking(r("2026-10-07"), mk(), ctx()))).toEqual([
      "DATE_IN_PAST",
    ]);
  });
  it("window follows the supplied Toronto today (late evening UTC does not shift it)", () => {
    // caller passes Toronto today; at 2026-10-09T01:00Z Toronto is still 10-08
    expect(
      codes(validateBooking(r("2026-10-08"), mk(), ctx("2026-10-08"))),
    ).toEqual([]);
  });
  it("service radius: exact metres inside, one metre less outside", () => {
    const req = r("2026-10-10", {
      locationType: "customer_home",
      customerPostal: "M5V 2T6",
    });
    const exact = validateBooking(
      req,
      mk({ serviceRadiusKm: metres / 1000 }),
      ctx(),
    );
    expect(codes(exact)).toEqual([]);
    const less = validateBooking(
      req,
      mk({ serviceRadiusKm: (metres - 1) / 1000 }),
      ctx(),
    );
    expect(codes(less)).toEqual(["OUTSIDE_SERVICE_AREA"]);
  });
  it("haversine symmetric and metres integer", () => {
    expect(haversineKm(C, far)).toBeCloseTo(haversineKm(far, C), 9);
    expect(Number.isInteger(metres)).toBe(true);
  });
  it("chef home matrix", () => {
    for (const [status, opts, en, want] of [
      ["approved", ["chef_home"], true, []],
      ["approved", ["chef_home"], false, ["CHEF_HOME_NOT_ENABLED"]],
      ["approved", ["customer_home"], true, ["LOCATION_NOT_OFFERED"]],
      ["pending", ["chef_home"], true, ["CHEF_NOT_BOOKABLE"]],
      ["rejected", ["chef_home"], true, ["CHEF_NOT_BOOKABLE"]],
    ] as const)
      expect(
        codes(
          validateBooking(
            r("2026-10-10"),
            mk({ status, locationOptions: opts, chefHomeEnabled: en }),
            ctx(),
          ),
        ),
      ).toEqual(want);
  });
  it("6 hour limit per day: 360 ok, 361 flagged, only the long day", () => {
    const dishes = [
      {
        id: "d",
        chefId: "c",
        name: "D",
        isActive: true,
        cookMinutes: 360,
        ingredientCostCents: 0,
        allergens: [],
        shelfLifeDays: 2,
      },
      {
        id: "e",
        chefId: "c",
        name: "E",
        isActive: true,
        cookMinutes: 5,
        ingredientCostCents: 0,
        allergens: [],
        shelfLifeDays: 2,
      },
    ];
    const chef = mk({
      dishes,
      availableDates: new Set(["2026-10-10", "2026-10-11"]),
    });
    const ok = validateBooking(r("2026-10-10"), chef, ctx());
    expect(ok.ok).toBe(true);
    const bad = validateBooking(
      {
        ...r("2026-10-10"),
        days: [
          {
            date: "2026-10-10",
            dishes: [
              { dishId: "d", quantity: 1 },
              { dishId: "e", quantity: 1 },
            ],
          },
          { date: "2026-10-11", dishes: [{ dishId: "e", quantity: 1 }] },
        ],
      },
      chef,
      ctx(),
    );
    expect(bad.errors.map((e) => [e.code, e.dayIndex])).toEqual([
      ["VISIT_TOO_LONG", 0],
    ]);
    expect(bad.warnings[0].overByMinutes).toBe(5);
  });
  it("quantity limit placeholder", () => {
    expect(MAX_DISH_QUANTITY).toBe(10);
    const q = (n: number) =>
      codes(
        validateBooking(
          {
            ...r("2026-10-10"),
            days: [
              { date: "2026-10-10", dishes: [{ dishId: "d", quantity: n }] },
            ],
          },
          mk({ dishes: [{ ...mk().dishes[0], cookMinutes: 5 }] }),
          ctx(),
        ),
      );
    expect(q(10)).toEqual([]);
    expect(q(11)).toEqual(["QUANTITY_INVALID"]);
    for (const n of [0, -1, 1.5, NaN, Infinity])
      expect(q(n)).toEqual(["QUANTITY_INVALID"]);
  });
  it("malformed input does not throw", () => {
    expect(() =>
      validateBooking(
        { locationType: "chef_home", days: null } as never,
        mk(),
        ctx(),
      ),
    ).not.toThrow();
    expect(() =>
      validateBooking(
        { locationType: "chef_home", days: [null] } as never,
        mk(),
        ctx(),
      ),
    ).not.toThrow();
    expect(() =>
      validateBooking(
        {
          locationType: "chef_home",
          days: [{ date: "2026-10-10", dishes: [null] }],
        } as never,
        mk(),
        ctx(),
      ),
    ).not.toThrow();
  });
});
