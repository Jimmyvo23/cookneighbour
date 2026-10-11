import { describe, expect, it } from "vitest";
import {
  decodeCursor,
  encodeCursor,
  evaluateLocation,
  isListable,
  parseSearchQuery,
  publicLocationOptions,
  rankChefs,
  type ChefCandidate,
  type PrefixRow,
  type SearchQuery,
} from "./search";

const PREFIXES: PrefixRow[] = [
  { prefix: "L5B", city: "Mississauga", lat: 43.592, lng: -79.642 },
  { prefix: "L5N", city: "Mississauga", lat: 43.595, lng: -79.74 },
  { prefix: "L6Y", city: "Brampton", lat: 43.68, lng: -79.76 },
  { prefix: "M5V", city: "Toronto", lat: 43.64, lng: -79.4 },
];
const TODAY = "2026-10-09";
const ctx = { today: TODAY, prefixes: PREFIXES };
const q = (s: string) => parseSearchQuery(new URLSearchParams(s), ctx);

describe("parseSearchQuery", () => {
  it("accepts an empty query with defaults", () => {
    const r = q("");
    expect(r.errors).toEqual({});
    expect(r.value).toMatchObject({
      point: null,
      avoid: [],
      limit: 20,
      cursor: null,
    });
  });

  it("resolves a full postal code, a spaced one and a prefix to the same area", () => {
    for (const code of ["L5B1A1", "l5b 1a1", "L5B"]) {
      const r = q(`postalCode=${encodeURIComponent(code)}`);
      expect(r.errors).toEqual({});
      expect(r.value!.point).toEqual({ lat: 43.592, lng: -79.642 });
    }
  });

  it("rejects malformed and non-GTA postal codes", () => {
    for (const code of [
      "K1A0B1",
      "L5B1D1",
      "L5B1A",
      "123",
      "L5X",
      "L5B 1A1 X",
    ]) {
      const r = q(`postalCode=${encodeURIComponent(code)}`);
      expect(r.errors.postalCode, code).toBe("Not a GTA postal code.");
    }
  });

  it("uses the average of a city's area centres (A-18)", () => {
    const r = q("city=mississauga");
    expect(r.value!.point!.lat).toBeCloseTo((43.592 + 43.595) / 2, 6);
    expect(r.value!.point!.lng).toBeCloseTo((-79.642 + -79.74) / 2, 6);
  });

  it("rejects an unknown city and both location params together", () => {
    expect(q("city=Atlantis").errors.city).toBeTruthy();
    expect(q("city=Toronto&postalCode=L5B").errors.city).toBeTruthy();
  });

  it("treats empty values as absent", () => {
    const r = q("postalCode=&city=&cuisine=%20&date=&limit=");
    expect(r.errors).toEqual({});
    expect(r.value!.point).toBeNull();
    expect(r.value!.limit).toBe(20);
  });

  it("rejects a parameter sent twice", () => {
    expect(q("cuisine=a&cuisine=b").errors.cuisine).toBeTruthy();
    expect(q("postalCode=L5B&postalCode=L5N").errors.postalCode).toBeTruthy();
  });

  it("validates cuisine and language text", () => {
    expect(q("cuisine=" + "x".repeat(41)).errors.cuisine).toBeTruthy();
    expect(q("language=a%00b").errors.language).toBeTruthy();
    expect(q("cuisine=Vietnamese&language=English").errors).toEqual({});
  });

  it("validates allergens: at most 14, each 1 to 40, safe text", () => {
    expect(q("avoidAllergens=Peanut,Soy").value!.avoid).toEqual([
      "peanut",
      "soy",
    ]);
    expect(
      q(
        "avoidAllergens=" +
          Array.from({ length: 15 }, (_, i) => `a${i}`).join(","),
      ).errors.avoidAllergens,
    ).toBeTruthy();
    expect(
      q("avoidAllergens=" + "x".repeat(41)).errors.avoidAllergens,
    ).toBeTruthy();
    expect(q("avoidAllergens=a%01").errors.avoidAllergens).toBeTruthy();
    // blanks between commas are dropped; duplicates merged
    expect(q("avoidAllergens=soy,,%20soy,").value!.avoid).toEqual(["soy"]);
  });

  it("validates rate bounds", () => {
    const ok = q("minRateCents=1500&maxRateCents=3000");
    expect(ok.value).toMatchObject({ minRateCents: 1500, maxRateCents: 3000 });
    for (const bad of [
      "minRateCents=-1",
      "minRateCents=1.5",
      "minRateCents=abc",
      "maxRateCents=100001",
      "minRateCents=1e3",
      "minRateCents=0x10",
    ])
      expect(Object.keys(q(bad).errors), bad).toHaveLength(1);
    expect(
      q("minRateCents=3000&maxRateCents=1500").errors.maxRateCents,
    ).toBeTruthy();
    expect(q("minRateCents=0").errors).toEqual({});
  });

  it("validates the date: real, and inside tomorrow..today+180 (D-15, D-27)", () => {
    expect(q(`date=${TODAY}`).errors.date).toMatch(/2026-10-10/); // no same-day bookings
    expect(q("date=2026-10-10").errors).toEqual({}); // tomorrow
    expect(q("date=2027-04-07").errors).toEqual({}); // today + 180
    expect(q("date=2027-04-08").errors.date).toBeTruthy();
    expect(q("date=2026-10-08").errors.date).toBeTruthy();
    expect(q("date=2026-02-30").errors.date).toBeTruthy();
    expect(q("date=tomorrow").errors.date).toBeTruthy();
  });

  it("validates the location type", () => {
    expect(q("locationType=chef_home").value!.locationType).toBe("chef_home");
    expect(q("locationType=customer_home").errors).toEqual({});
    expect(q("locationType=home").errors.locationType).toBeTruthy();
  });

  it("validates limit and cursor, and reports every error at once", () => {
    expect(q("limit=50").value!.limit).toBe(50);
    for (const bad of ["0", "51", "2.5", "x", "-1"])
      expect(q(`limit=${bad}`).errors.limit, bad).toBeTruthy();
    expect(q("cursor=garbage").errors.cursor).toBeTruthy();
    const all = q("postalCode=K1A&date=x&limit=0&locationType=x");
    expect(Object.keys(all.errors).sort()).toEqual([
      "date",
      "limit",
      "locationType",
      "postalCode",
    ]);
  });
});

describe("cursor", () => {
  it("round-trips and rejects anything else", () => {
    const key = { m: 1200, r: 4.5, n: "Anh", i: "id-1" };
    expect(decodeCursor(encodeCursor(key))).toEqual(key);
    const none = { m: null, r: 0, n: "", i: "x" };
    expect(decodeCursor(encodeCursor(none))).toEqual(none);
    for (const bad of [
      "",
      "%%%",
      "e30",
      Buffer.from('{"m":"x","r":1,"n":"a","i":"b"}').toString("base64url"),
      Buffer.from('{"m":1,"r":1,"n":"a"}').toString("base64url"),
      Buffer.from('{"m":1,"r":1,"n":"a","i":"b","z":1}').toString("base64url"),
      Buffer.from("[1]").toString("base64url"),
    ])
      expect(decodeCursor(bad), bad).toBeNull();
  });
});

describe("isListable (A-20)", () => {
  const ok = { bio: "Hello", photoPath: "a/photo-1.png", activeDishCount: 1 };
  it("needs a bio, a photo and an active dish", () => {
    expect(isListable(ok)).toBe(true);
    expect(isListable({ ...ok, bio: null })).toBe(false);
    expect(isListable({ ...ok, bio: "  \n " })).toBe(false);
    expect(isListable({ ...ok, photoPath: null })).toBe(false);
    expect(isListable({ ...ok, photoPath: "" })).toBe(false);
    expect(isListable({ ...ok, activeDishCount: 0 })).toBe(false);
  });
});

describe("publicLocationOptions", () => {
  it("shows chef_home only when enabled", () => {
    expect(
      publicLocationOptions(["customer_home", "chef_home"], false),
    ).toEqual(["customer_home"]);
    expect(publicLocationOptions(["customer_home", "chef_home"], true)).toEqual(
      ["customer_home", "chef_home"],
    );
    expect(publicLocationOptions(["chef_home"], false)).toEqual([]);
  });
});

describe("evaluateLocation (A-18)", () => {
  const base = {
    options: ["customer_home"] as ("customer_home" | "chef_home")[],
    chefHomeEnabled: false,
    radiusKm: 10,
  };
  it("includes a chef within the radius", () => {
    expect(evaluateLocation(base, 5, true, undefined)).toEqual({
      include: true,
      chefHomeOnly: false,
    });
    expect(evaluateLocation(base, 10, true, undefined).include).toBe(true);
  });
  it("leaves out a chef beyond the radius who has no chef's home", () => {
    expect(evaluateLocation(base, 10.01, true, undefined).include).toBe(false);
    expect(evaluateLocation(base, 10.01, true, "customer_home").include).toBe(
      false,
    );
    expect(evaluateLocation(base, null, true, undefined).include).toBe(false);
  });
  it("keeps an out-of-reach chef who is bookable at home, marked chef's-home only", () => {
    const both = {
      ...base,
      options: ["customer_home", "chef_home"] as (
        "customer_home" | "chef_home"
      )[],
      chefHomeEnabled: true,
    };
    expect(evaluateLocation(both, 30, true, undefined)).toEqual({
      include: true,
      chefHomeOnly: true,
    });
    expect(evaluateLocation(both, 30, true, "customer_home")).toEqual({
      include: true,
      chefHomeOnly: true,
    });
    expect(evaluateLocation(both, 3, true, undefined).chefHomeOnly).toBe(false);
  });
  it("does not count a chef's home that is not enabled", () => {
    const notEnabled = {
      ...base,
      options: ["customer_home", "chef_home"] as (
        "customer_home" | "chef_home"
      )[],
    };
    expect(evaluateLocation(notEnabled, 30, true, undefined).include).toBe(
      false,
    );
    expect(evaluateLocation(notEnabled, 3, true, "chef_home").include).toBe(
      false,
    );
    const onlyHome = {
      ...base,
      options: ["chef_home"] as ("customer_home" | "chef_home")[],
    };
    expect(evaluateLocation(onlyHome, 1, true, undefined).include).toBe(false);
  });
  it("chef_home filter ignores the radius", () => {
    const both = {
      ...base,
      options: ["customer_home", "chef_home"] as (
        "customer_home" | "chef_home"
      )[],
      chefHomeEnabled: true,
    };
    expect(evaluateLocation(both, 90, true, "chef_home").include).toBe(true);
    expect(evaluateLocation(base, 1, true, "chef_home").include).toBe(false);
  });
  it("without a search point the radius is not checked", () => {
    expect(evaluateLocation(base, null, false, undefined)).toEqual({
      include: true,
      chefHomeOnly: false,
    });
    const onlyHome = {
      options: ["chef_home"] as ("customer_home" | "chef_home")[],
      chefHomeEnabled: true,
      radiusKm: 5,
    };
    expect(evaluateLocation(onlyHome, null, false, undefined)).toEqual({
      include: true,
      chefHomeOnly: true,
    });
  });
});

function chef(over: Partial<ChefCandidate> & { id: string }): ChefCandidate {
  return {
    displayName: over.id,
    bio: "bio",
    photoPath: `${over.id}/photo-1.png`,
    cuisines: ["Vietnamese"],
    languages: ["English"],
    hourlyRateCents: 2500,
    currency: "CAD",
    ratingAvg: 0,
    reviewCount: 0,
    servicePrefix: "L5B",
    serviceRadiusKm: 15,
    locationOptions: ["customer_home"],
    chefHomeEnabled: false,
    activeDishes: [{ allergens: [] }],
    ...over,
  };
}
function query(over: Partial<SearchQuery> = {}): SearchQuery {
  return {
    point: null,
    avoid: [],
    limit: 20,
    cursor: null,
    ...over,
  };
}
const L5B = { lat: 43.592, lng: -79.642 };

describe("rankChefs", () => {
  it("sorts by distance, then rating, name, id", () => {
    const chefs = [
      chef({ id: "far", servicePrefix: "L5N", serviceRadiusKm: 30 }),
      chef({ id: "near-low", ratingAvg: 3 }),
      chef({ id: "near-high", ratingAvg: 4.8 }),
      chef({ id: "mid", servicePrefix: "L6Y", serviceRadiusKm: 40 }),
    ];
    const r = rankChefs(chefs, query({ point: L5B }), PREFIXES);
    expect(r.items.map((i) => i.id)).toEqual([
      "near-high",
      "near-low",
      "far",
      "mid",
    ]);
    expect(r.items[0].distanceKm).toBe(0);
    expect(r.items[2].distanceKm).toBeCloseTo(8.1, 0);
    expect(r.nextCursor).toBeNull();
  });

  it("falls back to rating, name, id without a search point and shows no distance", () => {
    const chefs = [
      chef({ id: "b", displayName: "B", ratingAvg: 4, reviewCount: 2 }),
      chef({ id: "a", displayName: "A", ratingAvg: 4, reviewCount: 2 }),
      chef({ id: "c", displayName: "C", ratingAvg: 5, reviewCount: 1 }),
      chef({ id: "d", displayName: "D", ratingAvg: 4, reviewCount: 9 }),
    ];
    const r = rankChefs(chefs, query(), PREFIXES);
    expect(r.items.map((i) => i.id)).toEqual(["c", "a", "b", "d"]);
    expect(r.items.every((i) => i.distanceKm === null)).toBe(true);
  });

  it("puts chefs without a centre last when a point is given (they are only kept via chef's home)", () => {
    const chefs = [
      chef({
        id: "nocentre",
        servicePrefix: null,
        locationOptions: ["customer_home", "chef_home"],
        chefHomeEnabled: true,
      }),
      chef({ id: "near" }),
    ];
    const r = rankChefs(chefs, query({ point: L5B }), PREFIXES);
    expect(r.items.map((i) => i.id)).toEqual(["near", "nocentre"]);
    expect(r.items[1]).toMatchObject({ distanceKm: null, chefHomeOnly: true });
  });

  it("applies A-20", () => {
    const chefs = [
      chef({ id: "ok" }),
      chef({ id: "nobio", bio: null }),
      chef({ id: "nophoto", photoPath: null }),
      chef({ id: "nodish", activeDishes: [] }),
    ];
    expect(rankChefs(chefs, query(), PREFIXES).items.map((i) => i.id)).toEqual([
      "ok",
    ]);
  });

  it("filters by cuisine and language, ignoring case", () => {
    const chefs = [
      chef({
        id: "v",
        cuisines: ["Vietnamese", "Thai"],
        languages: ["English", "Vietnamese"],
      }),
      chef({ id: "i", cuisines: ["Indian"], languages: ["Hindi"] }),
    ];
    const ids = (o: Partial<SearchQuery>) =>
      rankChefs(chefs, query(o), PREFIXES).items.map((i) => i.id);
    expect(ids({ cuisine: "vietnamese" })).toEqual(["v"]);
    expect(ids({ cuisine: " THAI " })).toEqual(["v"]);
    expect(ids({ cuisine: "viet" })).toEqual([]);
    expect(ids({ language: "hindi" })).toEqual(["i"]);
    expect(ids({ cuisine: "indian", language: "english" })).toEqual([]);
  });

  it("filters by rate bounds (inclusive); no rate fails a bound", () => {
    const chefs = [
      chef({ id: "20", hourlyRateCents: 2000 }),
      chef({ id: "30", hourlyRateCents: 3000 }),
      chef({ id: "none", hourlyRateCents: null }),
    ];
    const ids = (o: Partial<SearchQuery>) =>
      rankChefs(chefs, query(o), PREFIXES)
        .items.map((i) => i.id)
        .sort();
    expect(ids({})).toEqual(["20", "30", "none"]);
    expect(ids({ minRateCents: 2000, maxRateCents: 3000 })).toEqual([
      "20",
      "30",
    ]);
    expect(ids({ minRateCents: 2001 })).toEqual(["30"]);
    expect(ids({ maxRateCents: 2999 })).toEqual(["20"]);
  });

  it("uses the allergen rule (A-17): one active dish free of all", () => {
    const chefs = [
      chef({
        id: "mixed",
        activeDishes: [{ allergens: ["soy"] }, { allergens: [] }],
      }),
      chef({ id: "soy", activeDishes: [{ allergens: ["soy", "wheat"] }] }),
    ];
    const ids = (avoid: string[]) =>
      rankChefs(chefs, query({ avoid }), PREFIXES)
        .items.map((i) => i.id)
        .sort();
    expect(ids(["soy"])).toEqual(["mixed"]);
    expect(ids(["wheat"])).toEqual(["mixed"]);
    expect(ids([])).toEqual(["mixed", "soy"]);
  });

  it("applies the radius and chef's-home-only rule", () => {
    const chefs = [
      chef({ id: "in", servicePrefix: "L5B", serviceRadiusKm: 5 }),
      chef({ id: "out", servicePrefix: "M5V", serviceRadiusKm: 5 }),
      chef({
        id: "out-home",
        servicePrefix: "M5V",
        serviceRadiusKm: 5,
        locationOptions: ["customer_home", "chef_home"],
        chefHomeEnabled: true,
      }),
    ];
    const r = rankChefs(chefs, query({ point: L5B }), PREFIXES);
    expect(r.items.map((i) => [i.id, i.chefHomeOnly])).toEqual([
      ["in", false],
      ["out-home", true],
    ]);
    expect(r.items[1].locationOptions).toEqual(["customer_home", "chef_home"]);
  });

  it("returns only the public keys", () => {
    const r = rankChefs([chef({ id: "x" })], query(), PREFIXES);
    expect(Object.keys(r.items[0]).sort()).toEqual(
      [
        "id",
        "displayName",
        "photoPath",
        "cuisines",
        "languages",
        "hourlyRateCents",
        "currency",
        "ratingAvg",
        "reviewCount",
        "serviceCity",
        "serviceRadiusKm",
        "distanceKm",
        "locationOptions",
        "chefHomeOnly",
      ].sort(),
    );
    expect(r.items[0].serviceCity).toBe("Mississauga");
  });

  it("pages with a keyset cursor: no repeats, no gaps, stable when a chef is added", () => {
    const chefs = Array.from({ length: 7 }, (_, i) =>
      chef({ id: `c${i}`, displayName: `Chef ${i}`, ratingAvg: 5 - i * 0.1 }),
    );
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const r = rankChefs(
        chefs,
        query({ limit: 3, cursor: cursor ? decodeCursor(cursor) : null }),
        PREFIXES,
      );
      seen.push(...r.items.map((i) => i.id));
      cursor = r.nextCursor;
      if (!cursor) break;
      if (page === 0) chefs.push(chef({ id: "late", ratingAvg: 0.1 }));
    }
    expect(seen).toEqual(["c0", "c1", "c2", "c3", "c4", "c5", "c6", "late"]);
  });

  it("pages with a cursor across the distance sort and chefs without distance", () => {
    const chefs = [
      chef({ id: "a" }),
      chef({ id: "b" }),
      chef({ id: "c", servicePrefix: "L5N", serviceRadiusKm: 30 }),
      chef({
        id: "d",
        servicePrefix: null,
        locationOptions: ["chef_home"],
        chefHomeEnabled: true,
      }),
    ];
    const seen: string[] = [];
    let cursor = null as ReturnType<typeof decodeCursor>;
    for (let i = 0; i < 5; i++) {
      const r = rankChefs(
        chefs,
        query({ point: L5B, limit: 1, cursor }),
        PREFIXES,
      );
      seen.push(...r.items.map((x) => x.id));
      if (!r.nextCursor) break;
      cursor = decodeCursor(r.nextCursor);
    }
    expect(seen).toEqual(["a", "b", "c", "d"]);
  });
});
