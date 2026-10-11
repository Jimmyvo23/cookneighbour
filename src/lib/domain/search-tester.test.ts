// T-039 Tester: extra edge cases for the pure search rules (no database), plus static source guards
// for the public routes (anon client only, explicit approved filter, no private column selected).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeCursor,
  encodeCursor,
  parseSearchQuery,
  rankChefs,
  type ChefCandidate,
  type PrefixRow,
} from "./search";

const PREFIXES: PrefixRow[] = [
  { prefix: "L5B", city: "Mississauga", lat: 43.592, lng: -79.642 },
  { prefix: "L5N", city: "Mississauga", lat: 43.595, lng: -79.74 },
  { prefix: "M5V", city: "Toronto", lat: 43.64, lng: -79.4 },
];
const TODAY = "2026-10-09";
const ctx = { today: TODAY, prefixes: PREFIXES };
const q = (s: string) => parseSearchQuery(new URLSearchParams(s), ctx);
const b64 = (s: string) => Buffer.from(s).toString("base64url");

describe("date window edges (D-15)", () => {
  it("accepts tomorrow and today + 180, rejects today (D-27) and the days either side", () => {
    expect(q(`date=${TODAY}`).errors.date).toBeTruthy();
    expect(q("date=2026-10-10").errors).toEqual({});
    expect(q("date=2027-04-07").errors).toEqual({}); // 2026-10-09 + 180
    expect(q("date=2027-04-08").errors.date).toBeTruthy();
    expect(q("date=2026-10-08").errors.date).toBeTruthy();
  });
  it("rejects impossible and oddly formatted dates", () => {
    for (const d of ["2026-13-01", "2027-02-29", "2026-1-1", "20261010", "x"])
      expect(q(`date=${d}`).errors.date, d).toBeTruthy();
  });
});

describe("postal code letter rules", () => {
  it("rejects the letters D F I O Q U in any position and bad first letters", () => {
    for (const code of [
      "L5B1D1",
      "L5B1F1",
      "L5B1I1",
      "L5B1O1",
      "L5B1Q1",
      "L5B1U1",
      "L5BOA1",
      "D5B",
      "L5B1",
      "L5B-",
      "L5B1A1X",
      "%00",
    ])
      expect(
        q(`postalCode=${encodeURIComponent(code)}`).errors.postalCode,
        code,
      ).toBeTruthy();
  });
  it("whitespace-only postalCode and city are ignored", () => {
    const r = q("postalCode=%20%20&city=%20");
    expect(r.errors).toEqual({});
    expect(r.value!.point).toBeNull();
  });
  it("both postalCode and city is one 422 on city", () => {
    const r = q("postalCode=L5B&city=Toronto");
    expect(Object.keys(r.errors)).toEqual(["city"]);
  });
});

describe("city text", () => {
  it("is case-insensitive and trimmed; non-ASCII or unsafe text is a 422", () => {
    expect(q("city=%20MISSISSAUGA%20").errors).toEqual({});
    expect(q("city=Montr%C3%A9al").errors.city).toBeTruthy();
    expect(q("city=Toronto%00").errors.city).toBeTruthy();
    expect(q("city=%ED%A0%80").errors.city).toBeTruthy();
  });
});

describe("limit", () => {
  it("accepts leading zeros as the number, rejects everything that is not 1 to 50", () => {
    expect(q("limit=007").value!.limit).toBe(7);
    expect(q("limit=050").value!.limit).toBe(50);
    expect(q("limit=1").value!.limit).toBe(1);
    for (const l of [
      "0",
      "000",
      "51",
      "100",
      "1000",
      "%2B5",
      "-1",
      "5.0",
      "5e1",
      "0x5",
      "1,2",
      "%EF%BC%95",
    ])
      expect(q(`limit=${l}`).errors.limit, l).toBeTruthy();
    expect(q("limit=5&limit=6").errors.limit).toBeTruthy();
  });
});

describe("avoidAllergens", () => {
  it("lower-cases, trims, de-duplicates and ignores empty pieces", () => {
    expect(
      q("avoidAllergens=Soy%2C%20SOY%2C%2C%20Peanut").value!.avoid,
    ).toEqual(["soy", "peanut"]);
    expect(q("avoidAllergens=%2C%20%2C").value!.avoid).toEqual([]);
  });
  it("rejects a control character and an over-long entry", () => {
    expect(q("avoidAllergens=a%00b").errors.avoidAllergens).toBeTruthy();
    expect(
      q(`avoidAllergens=${"x".repeat(41)}`).errors.avoidAllergens,
    ).toBeTruthy();
  });
});

describe("cursor tampering", () => {
  it("rejects any cursor that is not exactly four known keys of the right type", () => {
    const bad = [
      b64("{}"),
      b64("null"),
      b64("123"),
      b64('"str"'),
      b64('{"m":1,"r":1,"n":"a","i":1}'),
      b64('{"m":1,"r":"1","n":"a","i":"b"}'),
      b64('{"m":true,"r":1,"n":"a","i":"b"}'),
      b64('{"m":1,"r":1e999,"n":"a","i":"b"}'),
      b64('{"m":1,"r":1,"n":"a","i":"b","__proto__":{}}'),
      b64("{not json"),
      encodeCursor({ m: 1, r: 1, n: "a", i: "b" }) + "=",
      encodeCursor({ m: 1, r: 1, n: "a", i: "b" }) + "+",
      "A".repeat(601),
      "../etc/passwd",
    ];
    for (const c of bad) expect(decodeCursor(c), c.slice(0, 30)).toBeNull();
  });
  it("a well-formed forged cursor is harmless: it only changes the start point", () => {
    const forged = encodeCursor({ m: -5, r: 99, n: "", i: "" });
    expect(decodeCursor(forged)).not.toBeNull();
    const r = rankChefs(
      [chef("a", "Anh", 0, "L5B")],
      { ...base(), cursor: decodeCursor(forged) },
      PREFIXES,
    );
    // paging after a key that sorts first returns everything, never a hidden chef
    expect(r.items.map((i) => i.id)).toEqual(["a"]);
  });
});

function base() {
  return {
    point: { lat: 43.592, lng: -79.642 },
    avoid: [] as string[],
    limit: 20,
    cursor: null,
  };
}
function chef(
  id: string,
  name: string,
  rating: number,
  prefix: string | null,
  over: Partial<ChefCandidate> = {},
): ChefCandidate {
  return {
    id,
    displayName: name,
    bio: "Hi",
    photoPath: `${id}/photo.png`,
    cuisines: ["Thai"],
    languages: ["English"],
    hourlyRateCents: 2500,
    currency: "CAD",
    ratingAvg: rating,
    reviewCount: 1,
    servicePrefix: prefix,
    serviceRadiusKm: 100,
    locationOptions: ["customer_home"],
    chefHomeEnabled: false,
    activeDishes: [{ allergens: [] }],
    ...over,
  };
}

describe("ties and paging", () => {
  it("full ties (distance, rating, name) break by id and page without repeats", () => {
    const cs = ["d", "b", "a", "c", "e"].map((id) =>
      chef(id, "Same", 4, "L5B"),
    );
    const seen: string[] = [];
    let cursor = null as ReturnType<typeof decodeCursor>;
    for (let i = 0; i < 10; i++) {
      const r = rankChefs(cs, { ...base(), limit: 2, cursor }, PREFIXES);
      seen.push(...r.items.map((x) => x.id));
      if (!r.nextCursor) break;
      cursor = decodeCursor(r.nextCursor);
    }
    expect(seen).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("a chef removed between pages does not skip or repeat anyone", () => {
    const cs = ["a", "b", "c", "d"].map((id) => chef(id, "Same", 4, "L5B"));
    const p1 = rankChefs(cs, { ...base(), limit: 2 }, PREFIXES);
    const rest = rankChefs(
      cs.filter((c) => c.id !== "a"),
      { ...base(), limit: 2, cursor: decodeCursor(p1.nextCursor!) },
      PREFIXES,
    );
    expect(rest.items.map((i) => i.id)).toEqual(["c", "d"]);
  });
  it("chefs without a distance sort after those with one, then by rating", () => {
    const r = rankChefs(
      [
        chef("n", "Nowhere", 5, null, {
          locationOptions: ["chef_home"],
          chefHomeEnabled: true,
        }),
        chef("far", "Far", 1, "M5V"),
        chef("near", "Near", 1, "L5B"),
      ],
      base(),
      PREFIXES,
    );
    expect(r.items.map((i) => i.id)).toEqual(["near", "far", "n"]);
  });
});

describe("radius boundary and unenabled chef's home", () => {
  it("includes a chef whose radius equals the rounded distance only if the true distance fits", () => {
    const d = rankChefs([chef("x", "X", 0, "M5V")], base(), PREFIXES).items[0]
      .distanceKm!;
    const wide = Math.ceil(d) + 1;
    const tight = Math.floor(d) - 1;
    const inc = rankChefs(
      [chef("x", "X", 0, "M5V", { serviceRadiusKm: wide })],
      base(),
      PREFIXES,
    );
    const exc = rankChefs(
      [chef("x", "X", 0, "M5V", { serviceRadiusKm: tight })],
      base(),
      PREFIXES,
    );
    expect(inc.items).toHaveLength(1);
    expect(exc.items).toHaveLength(0);
  });
  it("a chef who offers only an unenabled chef's home is hidden, with or without a point", () => {
    const c = chef("h", "H", 0, "L5B", {
      locationOptions: ["chef_home"],
      chefHomeEnabled: false,
    });
    for (const point of [base().point, null])
      for (const lt of [undefined, "customer_home", "chef_home"] as const)
        expect(
          rankChefs([c], { ...base(), point, locationType: lt }, PREFIXES)
            .items,
        ).toHaveLength(0);
  });
});

describe("source guards for the public routes", () => {
  const read = (rel: string) =>
    readFileSync(path.join(process.cwd(), rel), "utf8");
  const code = (rel: string) =>
    read(rel)
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n");
  const routes = [
    "src/app/api/chefs/route.ts",
    "src/app/api/chefs/[id]/route.ts",
    "src/app/api/reference/postal-prefixes/route.ts",
  ];
  const server = code("src/lib/server/search.ts");

  it("never imports the service-role client or reads the secret key", () => {
    for (const f of [
      ...routes,
      "src/lib/server/search.ts",
      "src/lib/domain/search.ts",
    ]) {
      const src = code(f);
      expect(src, f).not.toMatch(
        /supabase\/admin|createAdminClient|SECRET_KEY|getServiceSupabaseEnv/,
      );
    }
  });
  it("filters on status = approved in both the list and the detail query", () => {
    expect(server.match(/\.eq\("status", "approved"\)/g)).toHaveLength(2);
    expect(server).toMatch(/\.eq\("dishes\.is_active", true\)/);
    expect(server).toMatch(/\.eq\("is_active", true\)/);
    expect(server).toMatch(/\.eq\("available", true\)/);
  });
  it("selects only public columns and never touches private tables or storage", () => {
    // T-042: the only database functions it may call are the two read-only, dates-only helpers
    // (chef_booked_dates, chefs_booked_on); any other .rpc( is still a failure.
    const withoutDateHelpers = server.replace(
      /\.rpc\(\s*"(chef_booked_dates|chefs_booked_on)"/g,
      ".call(",
    );
    expect(withoutDateHelpers).not.toMatch(
      /chef_private|kitchen|police|id_check|food_handler|hash|phone|email|address|storage|\.rpc\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(/i,
    );
  });
  it("every route awaits connection() first and nothing else before it", () => {
    for (const f of routes) {
      const src = code(f);
      const first = src.indexOf("await ");
      expect(src.slice(first, first + 22), f).toBe("await connection();\n  ");
    }
  });
  it("the admin list guard still catches a missing requireAdmin", () => {
    // The same transform the guard test uses, applied to a route with the gate removed.
    const mutated = read("src/app/api/admin/chefs/route.ts")
      .replace("const admin = await requireAdmin();", "const admin = null;")
      .replace("await connection();", "");
    const first = mutated.indexOf("await ");
    expect(mutated.slice(first, first + 40)).not.toContain("requireAdmin()");
    // and the real file passes it
    const real = read("src/app/api/admin/chefs/route.ts").replace(
      "await connection();",
      "",
    );
    const f2 = real.indexOf("await ");
    expect(real.slice(f2, f2 + 40)).toContain("requireAdmin()");
    // connection() is the first await in the real file
    const raw = read("src/app/api/admin/chefs/route.ts");
    expect(raw.slice(raw.indexOf("await "), raw.indexOf("await ") + 19)).toBe(
      "await connection();",
    );
  });
});
