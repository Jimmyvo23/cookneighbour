import { describe, expect, it } from "vitest";
import type { PostalPrefix, PublicChefSearchItem } from "@/lib/api/types";
import {
  buildPins,
  buildQuery,
  chefPath,
  cityNames,
  dateWindow,
  distanceText,
  emptySearchForm,
  firstErrorField,
  formErrorsFromApi,
  locationText,
  mergePage,
  profilePhotoUrl,
  queryString,
  rateText,
  ratingText,
  searchPoint,
  validateSearchForm,
  type SearchFormValues,
} from "./search";

const PREFIXES: PostalPrefix[] = [
  { prefix: "L5B", city: "Mississauga", lat: 43.592, lng: -79.642 },
  { prefix: "L5C", city: "Mississauga", lat: 43.572, lng: -79.654 },
  { prefix: "M5V", city: "Toronto", lat: 43.64, lng: -79.4 },
];
const ctx = { today: "2026-10-10", prefixes: PREFIXES };
const form = (o: Partial<SearchFormValues> = {}): SearchFormValues => ({
  ...emptySearchForm(),
  ...o,
});

function item(o: Partial<PublicChefSearchItem> = {}): PublicChefSearchItem {
  return {
    id: "id-1",
    displayName: "Mai",
    photoPath: "a/b.png",
    cuisines: ["Vietnamese"],
    languages: ["English"],
    hourlyRateCents: 3000,
    currency: "CAD",
    ratingAvg: 4.5,
    reviewCount: 2,
    serviceCity: "Mississauga",
    serviceRadiusKm: 20,
    distanceKm: 3.04,
    locationOptions: ["customer_home"],
    chefHomeOnly: false,
    ...o,
  };
}

describe("buildQuery", () => {
  it("sends only what was filled in, with dollars as whole cents", () => {
    const q = buildQuery(
      form({
        postalCode: " L5B 1A1 ",
        cuisine: " Vietnamese ",
        minRate: "$20",
        maxRate: "35.5",
        date: "2026-10-12",
        avoidAllergens: ["peanuts", "tree nuts"],
      }),
    );
    expect(q).toEqual({
      postalCode: "L5B 1A1",
      cuisine: "Vietnamese",
      minRateCents: 2000,
      maxRateCents: 3550,
      date: "2026-10-12",
      avoidAllergens: "peanuts,tree nuts",
      locationType: "customer_home",
      limit: 20,
    });
  });

  it("leaves empty values out and never sends the nationality (there is no such field)", () => {
    const q = buildQuery(form());
    expect(Object.keys(q).sort()).toEqual(["limit", "locationType"]);
  });

  it("sends a city only when no postal code is given, never both", () => {
    expect(buildQuery(form({ city: "Toronto" })).city).toBe("Toronto");
    const both = buildQuery(form({ city: "Toronto", postalCode: "L5B" }));
    expect(both.postalCode).toBe("L5B");
    expect(both.city).toBeUndefined();
  });

  it("converts rates exactly (no float drift)", () => {
    expect(buildQuery(form({ minRate: "19.99" })).minRateCents).toBe(1999);
    expect(buildQuery(form({ minRate: "0.1" })).minRateCents).toBe(10);
    expect(buildQuery(form({ maxRate: "0" })).maxRateCents).toBe(0);
  });

  it("keeps the chosen cooking place", () => {
    expect(buildQuery(form({ locationType: "chef_home" })).locationType).toBe(
      "chef_home",
    );
  });
});

describe("queryString", () => {
  it("is stable and adds the cursor last", () => {
    const q = buildQuery(form({ city: "Toronto", cuisine: "Thai" }));
    expect(queryString(q)).toBe(
      "city=Toronto&cuisine=Thai&locationType=customer_home&limit=20",
    );
    expect(queryString(q, "abc_-1")).toBe(
      "city=Toronto&cuisine=Thai&locationType=customer_home&limit=20&cursor=abc_-1",
    );
  });

  it("encodes special characters", () => {
    const q = buildQuery(form({ cuisine: "Tex & Mex" }));
    expect(queryString(q)).toContain("cuisine=Tex+%26+Mex");
  });

  it("keeps a zero rate (0 is a value, not empty)", () => {
    const q = buildQuery(form({ maxRate: "0" }));
    expect(queryString(q)).toContain("maxRateCents=0");
  });
});

describe("validateSearchForm", () => {
  it("accepts an empty form (browse everyone)", () => {
    expect(validateSearchForm(form(), ctx)).toEqual({});
  });

  it("accepts a full code and a bare prefix, in any case", () => {
    expect(validateSearchForm(form({ postalCode: "l5b1a1" }), ctx)).toEqual({});
    expect(validateSearchForm(form({ postalCode: "L5B" }), ctx)).toEqual({});
  });

  it("rejects a non-GTA or malformed postal code", () => {
    expect(validateSearchForm(form({ postalCode: "V6B 1A1" }), ctx).postalCode)
      .toBeTruthy;
    expect(
      validateSearchForm(form({ postalCode: "V6B 1A1" }), ctx).postalCode,
    ).toMatch(/GTA/);
    expect(
      validateSearchForm(form({ postalCode: "12345" }), ctx).postalCode,
    ).toBeTruthy();
  });

  it("falls back to a format check when the GTA list did not load", () => {
    const noList = { today: ctx.today, prefixes: null };
    expect(validateSearchForm(form({ postalCode: "L5B 1A1" }), noList)).toEqual(
      {},
    );
    expect(
      validateSearchForm(form({ postalCode: "hello" }), noList).postalCode,
    ).toBeTruthy();
  });

  it("refuses a postal code and a city together", () => {
    expect(
      validateSearchForm(form({ postalCode: "L5B", city: "Toronto" }), ctx)
        .city,
    ).toMatch(/not both/);
  });

  it("checks rates: format, ceiling and order", () => {
    expect(
      validateSearchForm(form({ minRate: "abc" }), ctx).minRate,
    ).toBeTruthy();
    expect(
      validateSearchForm(form({ maxRate: "-5" }), ctx).maxRate,
    ).toBeTruthy();
    expect(
      validateSearchForm(form({ maxRate: "1000.01" }), ctx).maxRate,
    ).toBeTruthy();
    expect(validateSearchForm(form({ maxRate: "1000" }), ctx)).toEqual({});
    expect(
      validateSearchForm(form({ minRate: "40", maxRate: "20" }), ctx).maxRate,
    ).toMatch(/must not be below/);
    expect(
      validateSearchForm(form({ minRate: "20", maxRate: "20" }), ctx),
    ).toEqual({});
  });

  it("keeps the date inside today to today + 180 days", () => {
    expect(dateWindow("2026-10-10")).toEqual({
      min: "2026-10-10",
      max: "2027-04-08",
    });
    expect(validateSearchForm(form({ date: "2026-10-10" }), ctx)).toEqual({});
    expect(validateSearchForm(form({ date: "2027-04-08" }), ctx)).toEqual({});
    expect(
      validateSearchForm(form({ date: "2026-10-09" }), ctx).date,
    ).toBeTruthy();
    expect(
      validateSearchForm(form({ date: "2027-04-09" }), ctx).date,
    ).toBeTruthy();
    expect(
      validateSearchForm(form({ date: "2026-02-30" }), ctx).date,
    ).toBeTruthy();
  });

  it("limits text length", () => {
    expect(
      validateSearchForm(form({ cuisine: "x".repeat(41) }), ctx).cuisine,
    ).toBeTruthy();
  });
});

describe("errors and focus order", () => {
  it("maps API field names to form fields", () => {
    expect(
      formErrorsFromApi({ minRateCents: "a", maxRateCents: "b", date: "c" }),
    ).toEqual({ minRate: "a", maxRate: "b", date: "c" });
  });

  it("finds the first field with an error in form order", () => {
    expect(firstErrorField({ date: "x", cuisine: "y" })).toBe("cuisine");
    expect(firstErrorField({ postalCode: "x", date: "y" })).toBe("postalCode");
    expect(firstErrorField({ cursor: "bad" })).toBe("cursor");
    expect(firstErrorField({})).toBeNull();
  });
});

describe("mergePage (cursor handling)", () => {
  it("appends a page and names the first new result", () => {
    const a = item({ id: "a" });
    const b = item({ id: "b" });
    const c = item({ id: "c" });
    const r = mergePage([a, b], [c]);
    expect(r.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(r.firstNewId).toBe("c");
  });

  it("drops a chef the list already shows, and skips them for focus", () => {
    const a = item({ id: "a" });
    const b = item({ id: "b" });
    const c = item({ id: "c" });
    const r = mergePage([a, b], [b, c]);
    expect(r.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(r.firstNewId).toBe("c");
  });

  it("has no first new result when the page is all repeats or empty", () => {
    const a = item({ id: "a" });
    expect(mergePage([a], [a]).firstNewId).toBeNull();
    expect(mergePage([a], []).firstNewId).toBeNull();
  });
});

describe("formatting", () => {
  it("rate", () => {
    expect(rateText(3000)).toBe("$30/hour");
    expect(rateText(3050)).toBe("$30.50/hour");
    expect(rateText(null)).toBe("Rate not set");
  });
  it("distance", () => {
    expect(distanceText(3.04)).toBe("3.0 km away");
    expect(distanceText(null)).toBeNull();
  });
  it("rating", () => {
    expect(ratingText(0, 0)).toBe("No reviews yet");
    expect(ratingText(4.5, 1)).toBe("4.5 out of 5 (1 review)");
    expect(ratingText(4.25, 12)).toBe("4.3 out of 5 (12 reviews)");
  });
  it("location label says chef's home only for chefHomeOnly (A-18)", () => {
    expect(
      locationText(
        item({ chefHomeOnly: true, locationOptions: ["chef_home"] }),
      ),
    ).toBe("Chef's home only");
    expect(locationText(item())).toBe("At your home");
    expect(
      locationText(item({ locationOptions: ["customer_home", "chef_home"] })),
    ).toBe("At your home or the chef's home");
  });
  it("photo url", () => {
    expect(profilePhotoUrl("u/p one.png", "http://x.test/")).toBe(
      "http://x.test/storage/v1/object/public/profile-photos/u/p%20one.png",
    );
    expect(profilePhotoUrl("u/p.png", undefined)).toBeNull();
    expect(profilePhotoUrl(null, "http://x.test")).toBeNull();
  });
  it("chef path", () => {
    expect(chefPath("abc")).toBe("/chefs/abc");
    expect(chefPath("a/b")).toBe("/chefs/a%2Fb");
  });
  it("city names are distinct and sorted", () => {
    expect(cityNames(PREFIXES)).toEqual(["Mississauga", "Toronto"]);
  });
});

describe("map pins (area centres only)", () => {
  it("groups chefs by service city at the average of the city's area centres", () => {
    const pins = buildPins(
      [
        item({ id: "a" }),
        item({ id: "b", serviceCity: "mississauga " }),
        item({ id: "c", serviceCity: "Toronto" }),
        item({ id: "d", serviceCity: null }),
        item({ id: "e", serviceCity: "Nowhere" }),
      ],
      PREFIXES,
    );
    expect(pins.map((p) => [p.city, p.items.map((i) => i.id)])).toEqual([
      ["Mississauga", ["a", "b"]],
      ["Toronto", ["c"]],
    ]);
    expect(pins[0].point.lat).toBeCloseTo((43.592 + 43.572) / 2, 6);
    expect(pins[0].point.lng).toBeCloseTo((-79.642 + -79.654) / 2, 6);
  });

  it("finds the search point for a postal code or a city", () => {
    expect(searchPoint({ postalCode: "L5B 1A1" }, PREFIXES)?.label).toBe(
      "Area L5B",
    );
    expect(
      searchPoint({ postalCode: "L5B 1A1" }, PREFIXES)?.point.lat,
    ).toBeCloseTo(43.592);
    expect(searchPoint({ city: "toronto" }, PREFIXES)?.label).toBe("Toronto");
    expect(searchPoint({}, PREFIXES)).toBeNull();
    expect(searchPoint({ postalCode: "V6B" }, PREFIXES)).toBeNull();
  });
});
