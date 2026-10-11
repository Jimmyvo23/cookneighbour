import { describe, expect, it } from "vitest";
import {
  validateBooking,
  type BookableDish,
  type BookingChef,
  type BookingContext,
  type BookingIssueCode,
  type BookingRequest,
} from "./bookingValidation";
import { estimateBooking } from "./pricing";
import { addDays } from "./dishes";

const TODAY = "2026-10-08";
const CHEF_ID = "chef-1";
const centres = new Map([
  ["L5B", { lat: 43.5934, lng: -79.6446 }], // chef: Mississauga
  ["L5N", { lat: 43.5963, lng: -79.7559 }], // about 9 km away
  ["M5V", { lat: 43.6426, lng: -79.3871 }], // about 21 km away
]);

const dish = (over: Partial<BookableDish> = {}): BookableDish => ({
  id: "pho",
  chefId: CHEF_ID,
  name: "Pho",
  isActive: true,
  cookMinutes: 180,
  ingredientCostCents: 2500,
  allergens: ["soy"],
  shelfLifeDays: 2,
  ...over,
});
const D1 = "2026-10-10";
const D2 = "2026-10-11";
const D3 = "2026-10-12";

const chef = (over: Partial<BookingChef> = {}): BookingChef => ({
  id: CHEF_ID,
  status: "approved",
  locationOptions: ["customer_home", "chef_home"],
  chefHomeEnabled: true,
  serviceRadiusKm: 15,
  serviceCentre: centres.get("L5B")!,
  availableDates: new Set([
    D1,
    D2,
    D3,
    "2026-10-08",
    "2027-04-06",
    "2027-04-07",
  ]),
  dishes: [
    dish(),
    dish({
      id: "rolls",
      name: "Rolls",
      cookMinutes: 60,
      allergens: ["peanuts"],
    }),
    dish({ id: "off", name: "Retired", isActive: false }),
    dish({ id: "other", chefId: "someone-else" }),
    dish({ id: "long", name: "Feast", cookMinutes: 360 }),
  ],
  ...over,
});
const ctx = (over: Partial<BookingContext> = {}): BookingContext => ({
  today: TODAY,
  chefBookedDates: new Set(),
  centres,
  ...over,
});
const req = (over: Partial<BookingRequest> = {}): BookingRequest => ({
  locationType: "customer_home",
  customerPostal: "L5N 1A1",
  days: [{ date: D1, dishes: [{ dishId: "pho", quantity: 1 }] }],
  intake: { allergies: "None", dietaryNotes: "None" },
  ...over,
});
const codes = (r: ReturnType<typeof validateBooking>): BookingIssueCode[] =>
  r.errors.map((e) => e.code);

describe("validateBooking: the happy path", () => {
  it("accepts a valid one-day customer's-home booking and resolves dishes for the estimate", () => {
    const r = validateBooking(req(), chef(), ctx());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.distanceMetres).toBeGreaterThan(8000);
    expect(r.days).toHaveLength(1);
    const e = estimateBooking({
      hourlyRateCents: 3000,
      locationType: "customer_home",
      isFreeTrial: false,
      distanceMetres: r.distanceMetres,
      days: r.days.map((d) => ({ dishes: d.dishes })),
    });
    expect(e.cookMinutes).toBe(180);
  });
  it("accepts three days and a chef's-home booking without a postal code", () => {
    const r = validateBooking(
      req({
        locationType: "chef_home",
        customerPostal: undefined,
        days: [D1, D2, D3].map((date) => ({
          date,
          dishes: [{ dishId: "rolls", quantity: 2 }],
        })),
      }),
      chef(),
      ctx(),
    );
    expect(r.errors).toEqual([]);
    expect(r.distanceMetres).toBeNull();
  });
  it("reports every problem, not only the first", () => {
    const r = validateBooking(
      req({
        days: [{ date: "2020-01-01", dishes: [] }],
        customerPostal: "V6B1A1",
      }),
      chef(),
      ctx(),
    );
    expect(codes(r).sort()).toEqual(
      ["DATE_IN_PAST", "NO_DISHES", "POSTAL_NOT_GTA"].sort(),
    );
  });
});

describe("validateBooking: days and dates (CLAUDE.md 10)", () => {
  it("needs 1 to 3 days", () => {
    expect(codes(validateBooking(req({ days: [] }), chef(), ctx()))).toEqual([
      "DAYS_COUNT",
    ]);
    const four = [D1, D2, D3, "2026-10-08"].map((date) => ({
      date,
      dishes: [{ dishId: "rolls", quantity: 1 }],
    }));
    expect(
      codes(validateBooking(req({ days: four }), chef(), ctx())),
    ).toContain("DAYS_COUNT");
  });
  it("rejects a date in the past, and today too: day 1 is tomorrow at the earliest (D-27)", () => {
    const one = (date: string) =>
      codes(
        validateBooking(
          req({ days: [{ date, dishes: [{ dishId: "pho", quantity: 1 }] }] }),
          chef(),
          ctx(),
        ),
      );
    expect(one("2026-10-07")).toEqual(["DATE_IN_PAST"]);
    expect(one(TODAY)).toEqual(["DATE_TOO_SOON"]);
    expect(one(addDays(TODAY, 1))).toEqual(["CHEF_UNAVAILABLE"]);
    const ok = chef({
      availableDates: new Set([TODAY, addDays(TODAY, 1)]),
    });
    expect(
      validateBooking(
        req({
          days: [
            {
              date: addDays(TODAY, 1),
              dishes: [{ dishId: "pho", quantity: 1 }],
            },
          ],
        }),
        ok,
        ctx(),
      ).errors,
    ).toEqual([]);
  });
  it("today is refused on any day of a multi-day booking, not only day 1", () => {
    const r = validateBooking(
      req({
        days: [
          { date: D1, dishes: [{ dishId: "pho", quantity: 1 }] },
          { date: TODAY, dishes: [{ dishId: "pho", quantity: 1 }] },
        ],
      }),
      chef(),
      ctx(),
    );
    expect(r.errors.map((e) => [e.code, e.dayIndex])).toEqual([
      ["DATE_TOO_SOON", 1],
    ]);
  });
  it("the intake needs an explicit answer: blank allergies or dietary notes are refused (D-23)", () => {
    const blank = (allergies: string, dietaryNotes: string) =>
      codes(
        validateBooking(
          req({ intake: { allergies, dietaryNotes } }),
          chef(),
          ctx(),
        ),
      );
    expect(blank("", "None")).toEqual(["INTAKE_MISSING"]);
    expect(blank("None", "")).toEqual(["INTAKE_MISSING"]);
    expect(blank("   ", "None")).toEqual(["INTAKE_MISSING"]);
    expect(blank("None", " \n ")).toEqual(["INTAKE_MISSING"]);
    expect(blank("None", "None")).toEqual([]);
  });
  it("enforces the D-15 window: today + 180 days is the last bookable day", () => {
    const last = addDays(TODAY, 180);
    expect(last).toBe("2027-04-06");
    const one = (date: string) =>
      codes(
        validateBooking(
          req({ days: [{ date, dishes: [{ dishId: "pho", quantity: 1 }] }] }),
          chef(),
          ctx(),
        ),
      );
    expect(one(last)).toEqual([]);
    expect(one(addDays(last, 1))).toEqual(["DATE_BEYOND_WINDOW"]);
  });
  it("rejects malformed and impossible dates, and the same date twice", () => {
    const d = [{ dishId: "pho", quantity: 1 }];
    for (const date of ["2026-02-30", "tomorrow", "", "2026-1-5"])
      expect(
        codes(
          validateBooking(req({ days: [{ date, dishes: d }] }), chef(), ctx()),
        ),
      ).toEqual(["DATE_INVALID"]);
    const dup = validateBooking(
      req({
        days: [
          { date: D1, dishes: d },
          { date: D1, dishes: d },
        ],
      }),
      chef(),
      ctx(),
    );
    expect(codes(dup)).toContain("DATE_DUPLICATE");
    expect(dup.errors.find((e) => e.code === "DATE_DUPLICATE")?.dayIndex).toBe(
      1,
    );
  });
  it("needs the chef to have marked the date available", () => {
    const r = validateBooking(
      req({
        days: [
          { date: "2026-10-20", dishes: [{ dishId: "pho", quantity: 1 }] },
        ],
      }),
      chef(),
      ctx(),
    );
    expect(codes(r)).toEqual(["CHEF_UNAVAILABLE"]);
  });
  it("accepts availability as an array too", () => {
    expect(
      validateBooking(req(), chef({ availableDates: [D1] }), ctx()).ok,
    ).toBe(true);
  });
  it("blocks a double booking (A-9) on any of the days", () => {
    const r = validateBooking(
      req({
        days: [
          { date: D1, dishes: [{ dishId: "pho", quantity: 1 }] },
          { date: D2, dishes: [{ dishId: "pho", quantity: 1 }] },
        ],
      }),
      chef(),
      ctx({ chefBookedDates: new Set([D2]) }),
    );
    expect(r.errors).toEqual([
      expect.objectContaining({ code: "DOUBLE_BOOKED", dayIndex: 1 }),
    ]);
    expect(
      codes(validateBooking(req(), chef(), ctx({ chefBookedDates: [D1] }))),
    ).toEqual(["DOUBLE_BOOKED"]);
  });
});

describe("validateBooking: chef and location rules", () => {
  it("never accepts a pending or rejected chef", () => {
    for (const status of ["pending", "rejected"] as const)
      expect(codes(validateBooking(req(), chef({ status }), ctx()))).toEqual([
        "CHEF_NOT_BOOKABLE",
      ]);
  });
  it("chef's home only if the chef offers it", () => {
    const r = validateBooking(
      req({ locationType: "chef_home" }),
      chef({ locationOptions: ["customer_home"] }),
      ctx(),
    );
    expect(codes(r)).toEqual(["LOCATION_NOT_OFFERED"]);
  });
  it("chef's home also needs chef_home_enabled (kitchen approved by admin)", () => {
    const r = validateBooking(
      req({ locationType: "chef_home" }),
      chef({ chefHomeEnabled: false }),
      ctx(),
    );
    expect(codes(r)).toEqual(["CHEF_HOME_NOT_ENABLED"]);
  });
  it("customer's home needs the chef to offer it", () => {
    expect(
      codes(
        validateBooking(req(), chef({ locationOptions: ["chef_home"] }), ctx()),
      ),
    ).toEqual(["LOCATION_NOT_OFFERED"]);
  });
  it("chef's-home bookings ignore the service area and the postal code", () => {
    const r = validateBooking(
      req({ locationType: "chef_home", customerPostal: "V6B 1A1" }),
      chef({ serviceRadiusKm: 1 }),
      ctx(),
    );
    expect(r.errors).toEqual([]);
  });
  it("customer's home: inside the radius ok, outside refused", () => {
    const near = validateBooking(
      req({ customerPostal: "L5N1A1" }),
      chef(),
      ctx(),
    );
    expect(near.ok).toBe(true);
    const far = validateBooking(
      req({ customerPostal: "M5V 2T6" }),
      chef(),
      ctx(),
    );
    expect(codes(far)).toEqual(["OUTSIDE_SERVICE_AREA"]);
    expect(far.distanceMetres).toBeGreaterThan(15000);
    // the radius is the configurable boundary
    expect(
      validateBooking(
        req({ customerPostal: "M5V 2T6" }),
        chef({ serviceRadiusKm: 30 }),
        ctx(),
      ).ok,
    ).toBe(true);
  });
  it("customer's home: exactly on the radius is inside", () => {
    const r1 = validateBooking(req(), chef(), ctx());
    const km = Math.ceil((r1.distanceMetres as number) / 1000);
    expect(
      validateBooking(req(), chef({ serviceRadiusKm: km }), ctx()).ok,
    ).toBe(true);
    expect(
      codes(validateBooking(req(), chef({ serviceRadiusKm: km - 1 }), ctx())),
    ).toEqual(["OUTSIDE_SERVICE_AREA"]);
  });
  it("non-GTA, malformed or missing postal codes", () => {
    for (const p of ["V6B 1A1", "12345", "", "L5N", undefined])
      expect(
        codes(validateBooking(req({ customerPostal: p }), chef(), ctx())),
      ).toEqual(["POSTAL_NOT_GTA"]);
  });
  it("chef without a service area cannot take customer's-home bookings", () => {
    expect(
      codes(validateBooking(req(), chef({ serviceCentre: null }), ctx())),
    ).toEqual(["CHEF_NO_SERVICE_AREA"]);
  });
});

describe("validateBooking: dishes", () => {
  const one = (dishes: { dishId: string; quantity: number }[]) =>
    validateBooking(req({ days: [{ date: D1, dishes }] }), chef(), ctx());
  it("dishes must belong to the chef (another chef's dish looks like a missing one)", () => {
    expect(codes(one([{ dishId: "other", quantity: 1 }]))).toEqual([
      "DISH_NOT_FOUND",
    ]);
    expect(codes(one([{ dishId: "nope", quantity: 1 }]))).toEqual([
      "DISH_NOT_FOUND",
    ]);
  });
  it("dishes must be active", () => {
    expect(codes(one([{ dishId: "off", quantity: 1 }]))).toEqual([
      "DISH_INACTIVE",
    ]);
  });
  it("needs at least one dish per day, no repeats, sane quantity", () => {
    expect(codes(one([]))).toEqual(["NO_DISHES"]);
    expect(
      codes(
        one([
          { dishId: "rolls", quantity: 1 },
          { dishId: "rolls", quantity: 1 },
        ]),
      ),
    ).toEqual(["DISH_DUPLICATE"]);
    for (const q of [0, -1, 1.5, 11, NaN])
      expect(codes(one([{ dishId: "rolls", quantity: q }]))).toEqual([
        "QUANTITY_INVALID",
      ]);
  });
  it("blocks a day over the 6 hour soft limit with the day and the excess", () => {
    const r = validateBooking(
      req({
        days: [
          { date: D1, dishes: [{ dishId: "long", quantity: 1 }] }, // 360, ok
          {
            date: D2,
            dishes: [
              { dishId: "long", quantity: 1 },
              { dishId: "rolls", quantity: 1 },
            ],
          },
        ],
      }),
      chef(),
      ctx(),
    );
    expect(r.ok).toBe(false);
    expect(r.warnings).toEqual([
      {
        code: "VISIT_OVER_SOFT_LIMIT",
        dayIndex: 1,
        minutes: 420,
        overByMinutes: 60,
      },
    ]);
    expect(r.errors).toEqual([
      expect.objectContaining({ code: "VISIT_TOO_LONG", dayIndex: 1 }),
    ]);
    // splitting across days fixes it
    expect(
      validateBooking(
        req({
          days: [
            { date: D1, dishes: [{ dishId: "long", quantity: 1 }] },
            { date: D2, dishes: [{ dishId: "rolls", quantity: 1 }] },
          ],
        }),
        chef(),
        ctx(),
      ).ok,
    ).toBe(true);
  });
  it("quantity counts toward the soft limit", () => {
    expect(codes(one([{ dishId: "rolls", quantity: 7 }]))).toEqual([
      "VISIT_TOO_LONG",
    ]);
  });
});

describe("validateBooking: intake and allergies", () => {
  it("the intake form is mandatory", () => {
    expect(
      codes(validateBooking(req({ intake: undefined }), chef(), ctx())),
    ).toEqual(["INTAKE_MISSING"]);
  });
  it("an allergy that matches a chosen dish needs an acknowledgement", () => {
    const base = req({ intake: { allergies: "Soy", dietaryNotes: "None" } });
    const r = validateBooking(base, chef(), ctx());
    expect(codes(r)).toEqual(["ALLERGY_NOT_ACKNOWLEDGED"]);
    expect(r.allergyConflicts).toEqual([
      { dishId: "pho", dishName: "Pho", allergens: ["soy"] },
    ]);
    const ok = validateBooking(
      { ...base, allergyConflictAcknowledged: true },
      chef(),
      ctx(),
    );
    expect(ok.ok).toBe(true);
    expect(ok.allergyConflicts).toHaveLength(1); // still reported for the chef and the UI
  });
  it("no conflict when the allergy is not in the chosen dishes", () => {
    const r = validateBooking(
      req({ intake: { allergies: "shellfish", dietaryNotes: "None" } }),
      chef(),
      ctx(),
    );
    expect(r.ok).toBe(true);
    expect(r.allergyConflicts).toEqual([]);
  });
  it("the same dish on two days is one conflict", () => {
    const r = validateBooking(
      req({
        intake: { allergies: "soy", dietaryNotes: "None" },
        days: [D1, D2].map((date) => ({
          date,
          dishes: [{ dishId: "pho", quantity: 1 }],
        })),
      }),
      chef(),
      ctx(),
    );
    expect(r.allergyConflicts).toHaveLength(1);
  });
});
