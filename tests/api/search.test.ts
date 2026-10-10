// T-039: public search, chef detail and the postal-prefix list (contract section 7). Runs against
// the LOCAL Supabase. The database is shared with the other API test files, so every chef made
// here carries a cuisine tag that is unique to its test, and searches filter on it.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as searchRoute } from "@/app/api/chefs/route";
import { GET as detailRoute } from "@/app/api/chefs/[id]/route";
import { GET as prefixRoute } from "@/app/api/reference/postal-prefixes/route";
import { makeBooking } from "../rls/helpers";
import { Browser, freshLimits, rand, type Reply } from "./harness";
import {
  newAdmin,
  newChef,
  newCustomer,
  setChef,
  svc,
  type Chef,
} from "./chef-helpers";
import { addDays, createDish, patchDish, putDays, today } from "./dish-helpers";

// A new tag per test, so chefs made by an earlier test never show up in a later one.
let TAG = `Cx${rand(3)}`;
beforeEach(() => {
  freshLimits();
  TAG = `Cx${rand(3)}`;
});
let counter = 0;

const search = (b: Browser, qs = "") =>
  b.call(
    (r) => searchRoute(new Request(`http://localhost/api/chefs?${qs}`, r)),
    { method: "GET" },
  );
const detail = (b: Browser, id: string) =>
  b.call(
    (r) =>
      detailRoute(new Request(`http://localhost/api/chefs/${id}`, r), {
        params: Promise.resolve({ id }),
      }),
    { method: "GET" },
  );
const q = (extra = "") => `cuisine=${TAG}${extra ? `&${extra}` : ""}`;
const ids = (r: Reply) => (r.body.items as { id: string }[]).map((i) => i.id);

interface PubOpts {
  name?: string;
  cuisines?: string[];
  languages?: string[];
  rate?: number;
  prefix?: string | null;
  radius?: number;
  options?: string[];
  homeEnabled?: boolean;
  bio?: string | null;
  photo?: boolean;
  status?: "pending" | "approved" | "rejected";
  rating?: number;
  dishes?: { allergens?: string[]; active?: boolean; name?: string }[];
}

/** A chef made through the real routes, then set up by the service role like an admin would. */
async function pub(o: PubOpts = {}): Promise<Chef> {
  counter += 1;
  const chef = await newChef(
    o.name ?? `Chef ${String(counter).padStart(3, "0")}`,
  );
  await setChef(chef.id, {
    status: o.status ?? "approved",
    bio: o.bio === undefined ? "A friendly home cook." : o.bio,
    photo_path:
      o.photo === false ? null : `${chef.id}/photo-${randomUUID()}.png`,
    cuisines: o.cuisines ?? [TAG],
    languages: o.languages ?? ["English"],
    hourly_rate_cents: o.rate ?? 2500,
    service_postal_prefix: o.prefix === undefined ? "L5B" : o.prefix,
    service_radius_km: o.radius ?? 15,
    location_options: o.options ?? ["customer_home"],
    chef_home_enabled: o.homeEnabled ?? false,
    rating_avg: o.rating ?? 0,
    review_count: o.rating ? 3 : 0,
  });
  for (const d of o.dishes ?? [{}]) {
    const made = await createDish(chef, {
      name: d.name ?? "Pho bo",
      cuisine: TAG,
      allergens: d.allergens ?? [],
    });
    if (d.active === false)
      await chef.b.call(patchDish(made.id), {
        method: "PATCH",
        body: { isActive: false },
      });
  }
  return chef;
}

const anon = () => new Browser();
const NOT_FOUND = {
  error: { code: "NOT_FOUND", message: "Chef not found." },
};

describe("GET /api/reference/postal-prefixes", () => {
  it("is public, cacheable and exposes only prefix, city, lat, lng", async () => {
    const r = await anon().call(prefixRoute, { method: "GET" });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe(
      "public, max-age=3600, stale-while-revalidate=86400",
    );
    const items = r.body.items as Record<string, unknown>[];
    expect(items.length).toBeGreaterThan(40);
    for (const i of items)
      expect(Object.keys(i).sort()).toEqual(["city", "lat", "lng", "prefix"]);
    const l5b = items.find((i) => i.prefix === "L5B")!;
    expect(l5b.city).toBe("Mississauga");
    expect(typeof l5b.lat).toBe("number");
    const sorted = items.map((i) => i.prefix as string);
    expect(sorted).toEqual([...sorted].sort());
  });
});

describe("GET /api/chefs: location and distance", () => {
  it("sorts by distance from a postal code or prefix, nearest first", async () => {
    const far = await pub({ prefix: "M5V", radius: 100, name: "Far" });
    const mid = await pub({ prefix: "L5N", radius: 100, name: "Mid" });
    const near = await pub({ prefix: "L5B", radius: 100, name: "Near" });
    for (const code of ["L5B1A1", "l5b 1a1", "L5B"]) {
      const r = await search(
        anon(),
        q(`postalCode=${encodeURIComponent(code)}`),
      );
      expect(r.status, r.text).toBe(200);
      expect(ids(r)).toEqual([near.id, mid.id, far.id]);
      const km = r.body.items.map((i: { distanceKm: number }) => i.distanceKm);
      expect(km[0]).toBe(0);
      expect(km[1]).toBeGreaterThan(0);
      expect(km[2]).toBeGreaterThan(km[1]);
      expect(r.body.nextCursor).toBeNull();
    }
  });

  it("a city search uses the city centre (A-18)", async () => {
    const miss = await pub({ prefix: "L5B", radius: 100 });
    const tor = await pub({ prefix: "M5V", radius: 100 });
    const r = await search(anon(), q("city=mississauga"));
    expect(r.status, r.text).toBe(200);
    expect(ids(r)).toEqual([miss.id, tor.id]);
    expect(r.body.items[0].distanceKm).toBeLessThan(r.body.items[1].distanceKm);
    const t = await search(anon(), q("city=Toronto"));
    expect(ids(t)).toEqual([tor.id, miss.id]);
  });

  it("without a location there is no distance and the order is rating then name", async () => {
    const low = await pub({ name: "Aaa low", rating: 2 });
    const high = await pub({ name: "Zzz high", rating: 4.5 });
    const r = await search(anon(), q());
    expect(ids(r)).toEqual([high.id, low.id]);
    expect(
      r.body.items.every((i: { distanceKm: null }) => i.distanceKm === null),
    ).toBe(true);
  });

  it("leaves out a chef whose radius does not reach, unless the chef's home is bookable (A-18)", async () => {
    const inside = await pub({ prefix: "L5B", radius: 5, name: "Inside" });
    const outside = await pub({ prefix: "M5V", radius: 5, name: "Outside" });
    const outHome = await pub({
      prefix: "M5V",
      radius: 5,
      options: ["customer_home", "chef_home"],
      homeEnabled: true,
      name: "OutHome",
    });
    const outNotEnabled = await pub({
      prefix: "M5V",
      radius: 5,
      options: ["customer_home", "chef_home"],
      homeEnabled: false,
      name: "OutNotEnabled",
    });
    const onlyHome = await pub({
      prefix: "L6Y",
      radius: 5,
      options: ["chef_home"],
      homeEnabled: true,
      name: "OnlyHome",
    });

    for (const extra of ["", "&locationType=customer_home"]) {
      const r = await search(anon(), q(`postalCode=L5B${extra}`));
      expect(r.status, r.text).toBe(200);
      const got = Object.fromEntries(
        r.body.items.map((i: { id: string; chefHomeOnly: boolean }) => [
          i.id,
          i.chefHomeOnly,
        ]),
      );
      expect(got).toEqual({
        [inside.id]: false,
        [outHome.id]: true,
        [onlyHome.id]: true,
      });
      expect(Object.keys(got)).not.toContain(outside.id);
      expect(Object.keys(got)).not.toContain(outNotEnabled.id);
    }

    // chef_home filter: only chefs bookable at their own home, no radius check
    const home = await search(
      anon(),
      q("postalCode=L5B&locationType=chef_home"),
    );
    expect(new Set(ids(home))).toEqual(new Set([outHome.id, onlyHome.id]));

    // without a point the radius is not checked
    const all = await search(anon(), q());
    expect(new Set(ids(all))).toEqual(
      new Set([
        inside.id,
        outside.id,
        outHome.id,
        outNotEnabled.id,
        onlyHome.id,
      ]),
    );
    const flags = Object.fromEntries(
      all.body.items.map((i: { id: string; chefHomeOnly: boolean }) => [
        i.id,
        i.chefHomeOnly,
      ]),
    );
    expect(flags[inside.id]).toBe(false);
    expect(flags[onlyHome.id]).toBe(true);
  });

  it("shows chef_home as an option only when approved AND enabled", async () => {
    const on = await pub({
      options: ["customer_home", "chef_home"],
      homeEnabled: true,
    });
    const off = await pub({
      options: ["customer_home", "chef_home"],
      homeEnabled: false,
    });
    const r = await search(anon(), q());
    const byId = Object.fromEntries(
      r.body.items.map((i: { id: string; locationOptions: string[] }) => [
        i.id,
        i.locationOptions,
      ]),
    );
    expect(byId[on.id]).toEqual(["customer_home", "chef_home"]);
    expect(byId[off.id]).toEqual(["customer_home"]);
    const d = await detail(anon(), off.id);
    expect(d.body.locationOptions).toEqual(["customer_home"]);
    expect((await detail(anon(), on.id)).body.locationOptions).toEqual([
      "customer_home",
      "chef_home",
    ]);
  });

  it("a chef without a service area is listed only through the chef's home", async () => {
    const noArea = await pub({
      prefix: null,
      options: ["customer_home", "chef_home"],
      homeEnabled: true,
    });
    const noAreaCustomerOnly = await pub({ prefix: null });
    const r = await search(anon(), q("postalCode=L5B"));
    expect(ids(r)).toEqual([noArea.id]);
    expect(r.body.items[0]).toMatchObject({
      distanceKm: null,
      chefHomeOnly: true,
      serviceCity: null,
    });
    expect(ids(await search(anon(), q()))).toContain(noAreaCustomerOnly.id);
  });
});

describe("GET /api/chefs: filters", () => {
  it("cuisine and language match one entry, ignoring case", async () => {
    const viet = await pub({
      cuisines: [TAG, "Vietnamese"],
      languages: ["English", "Vietnamese"],
    });
    const thai = await pub({ cuisines: [TAG, "Thai"], languages: ["Thai"] });
    const ofTag = async (extra: string) =>
      new Set(ids(await search(anon(), `${extra}&${q()}`.replace(/^&/, ""))));
    // cuisine param is the tag; narrow further with language
    expect(new Set(ids(await search(anon(), q())))).toEqual(
      new Set([viet.id, thai.id]),
    );
    expect(await ofTag("language=vietnamese")).toEqual(new Set([viet.id]));
    expect(await ofTag("language=%20THAI%20")).toEqual(new Set([thai.id]));
    expect(await ofTag("language=Viet")).toEqual(new Set());
    const byCuisine = await search(
      anon(),
      "cuisine=vietnamese&language=english",
    );
    expect(ids(byCuisine)).toContain(viet.id);
    expect(ids(byCuisine)).not.toContain(thai.id);
  });

  it("price range uses the hourly rate, bounds inclusive", async () => {
    const a = await pub({ rate: 2000 });
    const b = await pub({ rate: 3000 });
    const c = await pub({ rate: 4000 });
    const set = async (extra: string) =>
      new Set(ids(await search(anon(), q(extra))));
    expect(await set("minRateCents=2000&maxRateCents=3000")).toEqual(
      new Set([a.id, b.id]),
    );
    expect(await set("minRateCents=3001")).toEqual(new Set([c.id]));
    expect(await set("maxRateCents=1999")).toEqual(new Set());
    expect(await set("minRateCents=0&maxRateCents=100000")).toEqual(
      new Set([a.id, b.id, c.id]),
    );
  });

  it("date: only chefs who ticked that day inside the window (A-19, D-15)", async () => {
    const d1 = addDays(today(), 3);
    const d2 = addDays(today(), 4);
    const yes = await pub();
    const other = await pub();
    const none = await pub();
    await putDays(yes, { add: [d1, d2] });
    await putDays(other, { add: [d2] });
    const set = async (date: string) =>
      new Set(ids(await search(anon(), q(`date=${date}`))));
    expect(await set(d1)).toEqual(new Set([yes.id]));
    expect(await set(d2)).toEqual(new Set([yes.id, other.id]));
    expect(await set(addDays(today(), 5))).toEqual(new Set());
    expect(ids(await search(anon(), q()))).toContain(none.id);
    // the join does not duplicate a chef with several ticked days
    const both = await search(anon(), q(`date=${d2}`));
    expect(ids(both).filter((x) => x === yes.id)).toHaveLength(1);
    // a day stored with available = false never matches
    await svc
      .from("availability")
      .insert({ chef_id: none.id, day: d1, available: false });
    expect(await set(d1)).toEqual(new Set([yes.id]));
  });

  it("dietary: a chef matches when one active dish avoids every allergen (A-17)", async () => {
    const mixed = await pub({
      dishes: [{ allergens: ["soy", "peanut"] }, { allergens: ["wheat"] }],
    });
    const allSoy = await pub({ dishes: [{ allergens: ["soy"] }] });
    const inactiveSafe = await pub({
      dishes: [{ allergens: ["soy"] }, { allergens: [], active: false }],
    });
    const set = async (avoid: string) =>
      new Set(
        ids(
          await search(
            anon(),
            q(`avoidAllergens=${encodeURIComponent(avoid)}`),
          ),
        ),
      );
    expect(await set("soy")).toEqual(new Set([mixed.id]));
    expect(await set("Soy, WHEAT")).toEqual(new Set()); // no single dish avoids both soy and wheat
    expect(await set("peanut")).toEqual(
      new Set([mixed.id, allSoy.id, inactiveSafe.id]),
    );
    expect(await set("sesame")).toEqual(
      new Set([mixed.id, allSoy.id, inactiveSafe.id]),
    );
  });
});

describe("A-20: incomplete approved chefs are not public", () => {
  it("hides a chef with no bio, no photo or no active dish from search and detail, with one 404", async () => {
    const ok = await pub();
    const noBio = await pub({ bio: null });
    const blankBio = await pub({ bio: "   " });
    const noPhoto = await pub({ photo: false });
    const noDish = await pub({ dishes: [] });
    const inactiveOnly = await pub({ dishes: [{ active: false }] });
    expect(ids(await search(anon(), q()))).toEqual([ok.id]);
    const unknown = await detail(anon(), randomUUID());
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual(NOT_FOUND);
    for (const hidden of [noBio, blankBio, noPhoto, noDish, inactiveOnly]) {
      const r = await detail(anon(), hidden.id);
      expect(r.status).toBe(404);
      expect(r.body).toEqual(unknown.body);
      expect(r.text).toBe(unknown.text);
    }
    expect((await detail(anon(), ok.id)).status).toBe(200);
  });
});

describe("pending and rejected chefs never appear (CLAUDE.md section 10)", () => {
  it("for visitors, customers, the chef themselves, a booking counterparty and an admin", async () => {
    const approved = await pub();
    // A booking can only be made with an approved chef, so these two are approved first, get their
    // bookings, and are then moved back (pending) and rejected, like a chef an admin pulled.
    const pending = await pub();
    const rejected = await pub();
    const customer = await newCustomer();
    const counterparty = await newCustomer();
    await makeBooking(svc, {
      customer: { id: counterparty.id, email: counterparty.email },
      chef: { id: pending.id, email: pending.email },
      dates: [addDays(today(), 10)],
    });
    await makeBooking(svc, {
      customer: { id: counterparty.id, email: counterparty.email },
      chef: { id: rejected.id, email: rejected.email },
      dates: [addDays(today(), 11)],
    });
    await setChef(pending.id, { status: "pending" });
    await setChef(rejected.id, { status: "rejected" });
    const admin = await newAdmin();
    const unknown = (await detail(anon(), randomUUID())).text;

    const viewers: [string, Browser][] = [
      ["visitor", anon()],
      ["customer", customer.b],
      ["pending chef", pending.b],
      ["rejected chef", rejected.b],
      ["approved chef", approved.b],
      ["booking counterparty", counterparty.b],
      ["admin", admin.b],
    ];
    for (const [who, b] of viewers) {
      const r = await search(b, q());
      expect(r.status, who).toBe(200);
      expect(ids(r), who).toEqual([approved.id]);
      // also with every other filter that could pull a row in
      const loc = await search(b, q("postalCode=L5B&locationType=chef_home"));
      expect(ids(loc), who).toEqual([]);
      for (const hidden of [pending, rejected]) {
        const d = await detail(b, hidden.id);
        expect(d.status, who).toBe(404);
        expect(d.text, who).toBe(unknown);
      }
      expect((await detail(b, approved.id)).status, who).toBe(200);
    }
    // approving the pending chef is the control
    await setChef(pending.id, { status: "approved" });
    expect(new Set(ids(await search(anon(), q())))).toEqual(
      new Set([approved.id, pending.id]),
    );
    expect((await detail(anon(), pending.id)).status).toBe(200);
  });

  it("everything the unfiltered list returns is approved in the database", async () => {
    await pub();
    await pub({ status: "pending" });
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 40; i++) {
      const r: Reply = await search(
        anon(),
        `limit=50${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(r.status, r.text).toBe(200);
      seen.push(...ids(r));
      cursor = r.body.nextCursor;
      if (!cursor) break;
    }
    expect(new Set(seen).size).toBe(seen.length);
    if (seen.length) {
      const { data } = await svc
        .from("chefs")
        .select("profile_id,status")
        .in("profile_id", seen);
      expect(data!.length).toBe(seen.length);
      expect(data!.every((c) => c.status === "approved")).toBe(true);
    }
  });
});

describe("no private data", () => {
  it("search items and detail carry exactly the public keys", async () => {
    const chef = await pub({
      options: ["customer_home", "chef_home"],
      homeEnabled: true,
    });
    // private fields exist in the database for this chef
    await svc
      .from("chef_private")
      .update({
        kitchen_address_line: "12 Secret Lane",
        kitchen_city: "Mississauga",
        kitchen_postal_code: "L5B1A1",
        kitchen_photo_paths: [`${chef.id}/kitchen-${randomUUID()}.png`],
        reject_reason: "internal note",
      })
      .eq("chef_id", chef.id);
    await putDays(chef, { add: [addDays(today(), 2)] });

    const list = await search(anon(), q("postalCode=L5B"));
    expect(Object.keys(list.body).sort()).toEqual(["items", "nextCursor"]);
    expect(Object.keys(list.body.items[0]).sort()).toEqual(
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
    const d = await detail(anon(), chef.id);
    expect(d.status, d.text).toBe(200);
    expect(Object.keys(d.body).sort()).toEqual(
      [
        "id",
        "displayName",
        "bio",
        "photoPath",
        "cuisines",
        "languages",
        "hourlyRateCents",
        "currency",
        "ratingAvg",
        "reviewCount",
        "serviceCity",
        "serviceRadiusKm",
        "locationOptions",
        "dishes",
        "bookableDates",
        "today",
        "lastBookableDay",
      ].sort(),
    );
    expect(Object.keys(d.body.dishes[0]).sort()).toEqual(
      [
        "id",
        "name",
        "photoPath",
        "description",
        "cuisine",
        "cookMinutes",
        "ingredientCostCents",
        "servings",
        "allergens",
        "shelfLifeDays",
      ].sort(),
    );
    for (const text of [list.text, d.text]) {
      for (const secret of [
        "Secret",
        "kitchen-",
        "internal note",
        chef.email,
        "phone",
        "hash",
      ])
        expect(text).not.toContain(secret);
    }
  });
});

describe("GET /api/chefs/:id", () => {
  it("returns active dishes oldest first and bookable dates inside the window only", async () => {
    const chef = await pub({
      dishes: [{ name: "First" }, { name: "Gone", active: false }],
    });
    await createDish(chef, {
      name: "Second",
      cuisine: "Vietnamese",
      cookMinutes: 90,
      servings: 4,
      allergens: ["Soy"],
      ingredientCostCents: 1500,
      description: "Good.",
    });
    const t = today();
    const inside = [addDays(t, 1), addDays(t, 2), addDays(t, 180)];
    await putDays(chef, { add: inside });
    // rows the route would refuse, written by the service role: past, beyond the window, unavailable
    await svc.from("availability").insert([
      { chef_id: chef.id, day: addDays(t, -1) },
      { chef_id: chef.id, day: addDays(t, 181) },
      { chef_id: chef.id, day: addDays(t, 5), available: false },
    ]);
    const other = await pub();
    await putDays(other, { add: [addDays(t, 7)] });

    const r = await detail(anon(), chef.id);
    expect(r.status, r.text).toBe(200);
    expect(r.body.dishes.map((d: { name: string }) => d.name)).toEqual([
      "First",
      "Second",
    ]);
    expect(r.body.dishes[1]).toMatchObject({
      cuisine: "Vietnamese",
      cookMinutes: 90,
      servings: 4,
      allergens: ["soy"],
      ingredientCostCents: 1500,
      description: "Good.",
      shelfLifeDays: 2,
    });
    expect(r.body.bookableDates).toEqual(inside);
    expect(r.body.today).toBe(t);
    expect(r.body.lastBookableDay).toBe(addDays(t, 180));
    expect(r.body).toMatchObject({
      id: chef.id,
      bio: "A friendly home cook.",
      serviceCity: "Mississauga",
      hourlyRateCents: 2500,
      currency: "CAD",
      locationOptions: ["customer_home"],
    });
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 404 for a non-uuid, an unknown id and an uppercase uuid of nobody", async () => {
    const unknown = await detail(anon(), randomUUID());
    for (const bad of [
      "abc",
      "123",
      "null",
      "%27%20or%201=1",
      randomUUID().toUpperCase(),
    ]) {
      const r = await detail(anon(), bad);
      expect(r.status, bad).toBe(404);
      expect(r.text, bad).toBe(unknown.text);
    }
  });
});

describe("validation (422) and paging", () => {
  const bad = async (qs: string, field: string) => {
    const r = await search(anon(), qs);
    expect(r.status, qs).toBe(422);
    expect(r.body.error.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(r.body.error.fields), qs).toContain(field);
    return r;
  };

  it("rejects malformed and non-GTA postal codes", async () => {
    for (const code of [
      "K1A0B1",
      "L5B1D1",
      "L5B1A",
      "12345",
      "L5X",
      "L5B%201A1%20X",
      "M0Z",
    ]) {
      const r = await bad(`postalCode=${code}`, "postalCode");
      expect(r.body.error.fields.postalCode).toBe("Not a GTA postal code.");
    }
  });

  it("rejects bad filters, all at once", async () => {
    await bad("city=Atlantis", "city");
    await bad("city=Toronto&postalCode=L5B", "city");
    await bad("cuisine=" + "x".repeat(41), "cuisine");
    await bad("language=a%00b", "language");
    await bad("cuisine=a&cuisine=b", "cuisine");
    await bad(
      "avoidAllergens=" +
        Array.from({ length: 15 }, (_, i) => `a${i}`).join(","),
      "avoidAllergens",
    );
    await bad("minRateCents=-1", "minRateCents");
    await bad("minRateCents=1.5", "minRateCents");
    await bad("maxRateCents=100001", "maxRateCents");
    await bad("minRateCents=3000&maxRateCents=2000", "maxRateCents");
    await bad(`date=${addDays(today(), -1)}`, "date");
    await bad(`date=${addDays(today(), 181)}`, "date");
    await bad("date=2026-02-30", "date");
    await bad("locationType=home", "locationType");
    await bad("limit=0", "limit");
    await bad("limit=51", "limit");
    await bad("cursor=nonsense", "cursor");
    const all = await bad(
      "postalCode=K1A&date=x&limit=0&locationType=x",
      "postalCode",
    );
    expect(Object.keys(all.body.error.fields).sort()).toEqual([
      "date",
      "limit",
      "locationType",
      "postalCode",
    ]);
  });

  it("ignores unknown parameters and empty values", async () => {
    const chef = await pub();
    const r = await search(anon(), q("foo=bar&postalCode=&date=&limit="));
    expect(r.status, r.text).toBe(200);
    expect(ids(r)).toEqual([chef.id]);
  });

  it("pages without repeats or gaps, also when a chef joins between pages", async () => {
    const made: Chef[] = [];
    for (let i = 0; i < 5; i++)
      made.push(
        await pub({
          prefix: i % 2 ? "L5B" : "L5N",
          radius: 100,
          name: `Page ${i}`,
        }),
      );
    const first = await search(anon(), q("postalCode=L5B&limit=2"));
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();
    const late = await pub({ prefix: "M5V", radius: 100, name: "Late" });
    const seen = [...ids(first)];
    let cursor: string | null = first.body.nextCursor;
    while (cursor) {
      const r: Reply = await search(
        anon(),
        q(`postalCode=L5B&limit=2&cursor=${cursor}`),
      );
      expect(r.status, r.text).toBe(200);
      seen.push(...ids(r));
      cursor = r.body.nextCursor;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(new Set(seen)).toEqual(new Set([...made.map((c) => c.id), late.id]));
    // distance order held across pages: the two L5B chefs come first
    expect(new Set(seen.slice(0, 2))).toEqual(
      new Set([made[1].id, made[3].id]),
    );
  });
});
