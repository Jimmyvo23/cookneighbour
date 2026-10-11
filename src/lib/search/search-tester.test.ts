import { describe, expect, it } from "vitest";
import type { PostalPrefix, PublicChefSearchItem } from "@/lib/api/types";
import { addDays, torontoToday } from "@/lib/domain/dishes";
import { parseSearchQuery } from "@/lib/domain/search";
import { MOCK_CHEFS, MOCK_PREFIXES } from "@/lib/mocks/mock-search";
import {
  buildPins,
  buildQuery,
  dateWindow,
  emptySearchForm,
  queryString,
  searchPoint,
  validateSearchForm,
  type SearchFormValues,
} from "./search";

// Tester (T-040). Edge cases on top of search.test.ts.
const form = (o: Partial<SearchFormValues> = {}): SearchFormValues => ({
  ...emptySearchForm(),
  ...o,
});
const TODAY = "2026-10-10";
const ctx = { today: TODAY, prefixes: MOCK_PREFIXES as PostalPrefix[] };

describe("dollars to cents at the edges (T-040)", () => {
  const cases: [string, number | "bad"][] = [
    ["0", 0],
    ["0.00", 0],
    ["0.5", 50],
    ["0.05", 5],
    ["25", 2500],
    ["$25", 2500],
    [" 25.50 ", 2550],
    ["1000", 100000],
    ["1000.00", 100000],
    ["1000.01", "bad"],
    ["1000.1", "bad"],
    ["999999", "bad"],
    ["9999999999999999999", "bad"],
    [".5", "bad"],
    ["25.", "bad"],
    ["25.555", "bad"],
    ["-1", "bad"],
    ["+5", "bad"],
    ["1e3", "bad"],
    ["1,000", "bad"],
    ["abc", "bad"],
    ["NaN", "bad"],
    ["Infinity", "bad"],
    ["٣٠", "bad"], // Arabic-Indic digits are not accepted
  ];
  for (const [text, want] of cases) {
    it(`min rate "${text}"`, () => {
      const errors = validateSearchForm(form({ minRate: text }), ctx);
      if (want === "bad") {
        expect(errors.minRate).toBeTruthy();
      } else {
        expect(errors.minRate).toBeUndefined();
        expect(buildQuery(form({ minRate: text })).minRateCents).toBe(want);
      }
    });
  }

  it("zero stays in the query string for both bounds", () => {
    const qs = queryString(buildQuery(form({ minRate: "0", maxRate: "0" })));
    expect(qs).toContain("minRateCents=0");
    expect(qs).toContain("maxRateCents=0");
  });

  it("min above max is refused next to the highest rate; equal is fine", () => {
    expect(
      validateSearchForm(form({ minRate: "30", maxRate: "29.99" }), ctx)
        .maxRate,
    ).toMatch(/not be below/);
    expect(
      validateSearchForm(form({ minRate: "30", maxRate: "30" }), ctx),
    ).toEqual({});
  });

  it("an invalid value is never sent: buildQuery drops it", () => {
    const q = buildQuery(form({ minRate: "abc", maxRate: "1e3" }));
    expect(q.minRateCents).toBeUndefined();
    expect(q.maxRateCents).toBeUndefined();
  });
});

describe("the form never accepts what the server would refuse for rate, date and place (T-040)", () => {
  // Whatever the quick check lets through must be accepted by the real parser; where the client
  // is stricter than the server that is allowed (the server stays the authority).
  const rates = ["", "0", "0.5", "25", "1000", "1000.01", "abc", "7.999"];
  const places: Partial<SearchFormValues>[] = [
    {},
    { postalCode: "L5B" },
    { postalCode: "l5b 1a1" },
    { postalCode: "L5B", city: "Toronto" },
    { postalCode: "V6B 1A1" },
    { city: "Mississauga" },
    { city: "richmond hill" },
  ];
  const dates = [
    "",
    TODAY,
    addDays(TODAY, -1),
    addDays(TODAY, 180),
    addDays(TODAY, 181),
    "2026-02-30",
    "2026-13-01",
  ];
  it("client OK implies server OK", () => {
    for (const minRate of rates)
      for (const maxRate of rates)
        for (const place of places)
          for (const date of dates) {
            const v = form({ minRate, maxRate, date, ...place });
            if (Object.keys(validateSearchForm(v, ctx)).length) continue;
            const qs = queryString(buildQuery(v));
            const parsed = parseSearchQuery(new URLSearchParams(qs), {
              today: TODAY,
              prefixes: MOCK_PREFIXES,
            });
            expect(parsed.errors, qs).toEqual({});
          }
  });
  it("the window ends are inclusive on both sides, on the client and the server", () => {
    const { min, max } = dateWindow(TODAY);
    expect(min).toBe(addDays(TODAY, 1)); // D-27: no same-day bookings
    expect(max).toBe("2027-04-08");
    expect(validateSearchForm(form({ date: min }), ctx)).toEqual({});
    expect(validateSearchForm(form({ date: max }), ctx)).toEqual({});
    expect(
      validateSearchForm(form({ date: addDays(max, 1) }), ctx).date,
    ).toBeTruthy();
    expect(
      validateSearchForm(form({ date: addDays(min, -1) }), ctx).date,
    ).toBeTruthy();
  });
});

describe("Toronto date window does not depend on the browser's time zone (T-040)", () => {
  // Toronto is UTC-4 until 2026-11-01 02:00 local, then UTC-5.
  const instants: [string, string][] = [
    ["2026-10-10T03:59:59Z", "2026-10-09"], // 23:59:59 in Toronto
    ["2026-10-10T04:00:00Z", "2026-10-10"], // midnight in Toronto
    ["2026-10-10T14:59:59Z", "2026-10-10"], // Tokyo is already Oct 11 at 00:00 (UTC+9)
    ["2026-10-10T10:00:00Z", "2026-10-10"], // Honolulu (UTC-10) is still Oct 10 00:00
    ["2026-10-11T03:59:59Z", "2026-10-10"],
    ["2026-11-01T03:59:59Z", "2026-10-31"], // last second before Toronto midnight (still EDT)
    ["2026-11-01T04:00:00Z", "2026-11-01"],
    ["2026-11-02T04:59:59Z", "2026-11-01"], // EST now: midnight is 05:00Z
    ["2026-11-02T05:00:00Z", "2026-11-02"],
    ["2027-03-14T04:59:59Z", "2027-03-13"], // before spring-forward (EST)
    ["2027-03-14T05:00:00Z", "2027-03-14"],
    ["2026-12-31T23:59:59Z", "2026-12-31"],
    ["2027-01-01T04:59:59Z", "2026-12-31"],
    ["2027-01-01T05:00:00Z", "2027-01-01"],
  ];
  for (const [iso, want] of instants)
    it(`${iso} is ${want} in Toronto`, () => {
      expect(torontoToday(new Date(iso))).toBe(want);
    });
});

describe("map pins sit at area centres, never at a chef (T-040)", () => {
  const prefixes: PostalPrefix[] = MOCK_PREFIXES as PostalPrefix[];
  const mk = (
    id: string,
    serviceCity: string | null,
  ): PublicChefSearchItem => ({
    id,
    displayName: id,
    photoPath: "x/y.png",
    cuisines: [],
    languages: [],
    hourlyRateCents: 1000,
    currency: "CAD",
    ratingAvg: 0,
    reviewCount: 0,
    serviceCity,
    serviceRadiusKm: 10,
    distanceKm: 1,
    locationOptions: ["customer_home"],
    chefHomeOnly: false,
  });

  it("every pin is exactly the average of its city's postal-area centres, whoever the chefs are", () => {
    const items = MOCK_CHEFS.map((c) =>
      mk(
        c.id,
        MOCK_PREFIXES.find((p) => p.prefix === c.servicePrefix)?.city ?? null,
      ),
    );
    const pins = buildPins(items, prefixes);
    expect(pins.length).toBeGreaterThan(3);
    for (const pin of pins) {
      const rows = prefixes.filter((p) => p.city === pin.city);
      expect(pin.point.lat).toBeCloseTo(
        rows.reduce((s, r) => s + r.lat, 0) / rows.length,
        9,
      );
      expect(pin.point.lng).toBeCloseTo(
        rows.reduce((s, r) => s + r.lng, 0) / rows.length,
        9,
      );
    }
  });

  it("chefs in different service areas of one city share one pin point (no chef-specific location)", () => {
    // M5V vs M4K are different areas in Toronto; one pin, one point.
    const pins = buildPins([mk("a", "Toronto"), mk("b", "toronto ")], prefixes);
    expect(pins).toHaveLength(1);
    expect(pins[0].items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("the pin point does not change with the chef's radius, distance or rate", () => {
    const a = buildPins([mk("a", "Brampton")], prefixes)[0].point;
    const b = buildPins(
      [{ ...mk("b", "Brampton"), serviceRadiusKm: 99, distanceKm: 42 }],
      prefixes,
    )[0].point;
    expect(a).toEqual(b);
  });

  it("a pin object carries only city, point and the public items", () => {
    const pin = buildPins([mk("a", "Oakville")], prefixes)[0];
    expect(Object.keys(pin).sort()).toEqual(["city", "items", "point"]);
    expect(Object.keys(pin.point).sort()).toEqual(["lat", "lng"]);
  });

  it("chefs without a city, or in a city missing from the reference list, get no pin", () => {
    expect(buildPins([mk("a", null), mk("b", "Atlantis")], prefixes)).toEqual(
      [],
    );
  });

  it("the search origin is an area centre or a city average, never more precise than a prefix", () => {
    const o = searchPoint({ postalCode: "L5B 1A1" }, prefixes)!;
    const row = prefixes.find((p) => p.prefix === "L5B")!;
    expect(o.point).toEqual({ lat: row.lat, lng: row.lng });
    expect(o.label).toBe("Area L5B");
    // A different full code in the same area gives the same point.
    expect(searchPoint({ postalCode: "L5B 9Z9" }, prefixes)!.point).toEqual(
      o.point,
    );
    expect(searchPoint({ postalCode: "V6B 1A1" }, prefixes)).toBeNull();
    expect(searchPoint({}, prefixes)).toBeNull();
  });
});
