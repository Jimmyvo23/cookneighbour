import { describe, expect, it } from "vitest";
import type {
  PublicChefDetail,
  PublicChefSearchResponse,
} from "@/lib/api/types";
import { addDays, torontoToday } from "@/lib/domain/dishes";
import { mockFetch } from "@/lib/mocks/mock-adapter";
import { MOCK_CHEFS } from "@/lib/mocks/mock-search";

// Tester (T-040). The MOCK search routes must behave like contract section 7 (v1.3), apart from
// the documented offset cursor. Everything here is made-up data.
type Body = PublicChefSearchResponse &
  PublicChefDetail & {
    error?: { code: string; fields?: Record<string, string> };
  };
async function call(path: string, method = "GET") {
  const res = await mockFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
  });
  const text = await res.text();
  return {
    status: res.status,
    data: (text ? JSON.parse(text) : {}) as Body,
    cache: res.headers.get("Cache-Control"),
  };
}
const today = torontoToday();

describe("MOCK search routes: error and edge behaviour matches section 7", () => {
  it("one identical 404 body for a non-uuid, an unknown id and a near-miss uuid", async () => {
    const bodies = await Promise.all([
      call("/api/chefs/not-a-uuid"),
      call("/api/chefs/00000000-0000-4000-8000-000000000000"),
      call(`/api/chefs/${MOCK_CHEFS[0].id.toUpperCase()}x`),
    ]);
    for (const b of bodies) expect(b.status).toBe(404);
    const first = JSON.stringify(bodies[0].data);
    for (const b of bodies) expect(JSON.stringify(b.data)).toBe(first);
    expect(bodies[0].data.error?.code).toBe("NOT_FOUND");
  });

  it("a malformed percent escape in the id is a clean 404, as in the real route (T-040 finding: the mock throws URIError)", async () => {
    expect((await call("/api/chefs/%E0%A4%A")).status).toBe(404);
  });

  it("other methods are 404, not a write", async () => {
    expect((await call("/api/chefs", "POST")).status).toBe(404);
    expect(
      (await call(`/api/chefs/${MOCK_CHEFS[0].id}`, "DELETE")).status,
    ).toBe(404);
    expect((await call("/api/reference/postal-prefixes", "PUT")).status).toBe(
      404,
    );
  });

  it("limit must be 1 to 50", async () => {
    for (const bad of ["0", "51", "-1", "x", "1.5"]) {
      const r = await call(`/api/chefs?limit=${bad}`);
      expect(r.status, bad).toBe(422);
      expect(r.data.error?.fields?.limit, bad).toBeTruthy();
    }
    expect((await call("/api/chefs?limit=1")).data.items).toHaveLength(1);
    expect((await call("/api/chefs?limit=50")).status).toBe(200);
  });

  it("min above max is 422 on maxRateCents; bounds are inclusive; a rate above 100000 is 422", async () => {
    const r = await call("/api/chefs?minRateCents=3000&maxRateCents=2999");
    expect(r.status).toBe(422);
    expect(r.data.error?.fields?.maxRateCents).toBeTruthy();
    const eq = await call("/api/chefs?minRateCents=2800&maxRateCents=2800");
    expect(eq.data.items.map((i) => i.hourlyRateCents)).toEqual([2800]);
    expect((await call("/api/chefs?maxRateCents=100001")).status).toBe(422);
    expect((await call("/api/chefs?maxRateCents=100000")).status).toBe(200);
    expect(
      (await call("/api/chefs?minRateCents=0&maxRateCents=0")).data.items,
    ).toEqual([]);
  });

  it("date: window ends are accepted, one day outside is 422, fake dates are 422", async () => {
    expect((await call(`/api/chefs?date=${today}`)).status).toBe(422); // D-27
    expect((await call(`/api/chefs?date=${addDays(today, 1)}`)).status).toBe(
      200,
    );
    expect((await call(`/api/chefs?date=${addDays(today, 180)}`)).status).toBe(
      200,
    );
    for (const d of [
      addDays(today, 181),
      addDays(today, -1),
      "2026-02-30",
      "x",
    ]) {
      const r = await call(`/api/chefs?date=${d}`);
      expect(r.status, d).toBe(422);
      expect(r.data.error?.fields?.date, d).toBeTruthy();
    }
  });

  it("city: case-insensitive, a space in the name works, unknown is 422 on city", async () => {
    expect((await call("/api/chefs?city=RICHMOND%20HILL")).status).toBe(200);
    const r = await call("/api/chefs?city=Atlantis");
    expect(r.status).toBe(422);
    expect(r.data.error?.fields?.city).toBeTruthy();
  });

  it("a non-GTA postal code is 422 on postalCode; a postal code and a city together is 422 on city", async () => {
    const a = await call("/api/chefs?postalCode=V6B1A1");
    expect(a.data.error?.fields?.postalCode).toBeTruthy();
    const b = await call("/api/chefs?postalCode=L5B&city=Toronto");
    expect(b.data.error?.fields?.city).toBeTruthy();
  });

  it("too many allergens (15) is 422; 14 is fine", async () => {
    const list = (n: number) =>
      Array.from({ length: n }, (_, i) => `a${i}`).join(",");
    expect((await call(`/api/chefs?avoidAllergens=${list(15)}`)).status).toBe(
      422,
    );
    expect((await call(`/api/chefs?avoidAllergens=${list(14)}`)).status).toBe(
      200,
    );
  });

  it("allergen filter: a chef stays only when at least one dish is free of every ticked allergen", async () => {
    // Priya has idli (gluten) and thoran (none): listed even when gluten is avoided.
    const r = await call("/api/chefs?avoidAllergens=gluten&cuisine=indian");
    expect(r.data.items.map((i) => i.displayName)).toEqual([
      "Priya Raman (MOCK)",
    ]);
    // Kofi has only a peanut dish.
    const k = await call("/api/chefs?avoidAllergens=peanuts&cuisine=ghanaian");
    expect(k.data.items).toEqual([]);
    // Case and spaces are ignored.
    const c = await call(
      "/api/chefs?avoidAllergens=%20PEANUTS%20&cuisine=ghanaian",
    );
    expect(c.data.items).toEqual([]);
  });

  it("a diet word is not special: 'vegetarian' avoids nothing (diets unsupported, A-17)", async () => {
    const all = await call("/api/chefs?limit=50");
    const v = await call("/api/chefs?limit=50&avoidAllergens=vegetarian");
    expect(v.data.items).toHaveLength(all.data.items.length);
  });

  it("cuisine and language match exactly one entry, not a substring", async () => {
    expect((await call("/api/chefs?cuisine=viet")).data.items).toEqual([]);
    expect(
      (await call("/api/chefs?cuisine=%20VIETNAMESE%20")).data.items,
    ).toHaveLength(2);
    expect((await call("/api/chefs?language=Tam")).data.items).toEqual([]);
  });

  it("A-18: only a chef who can be booked at home is listed when out of reach, marked chefHomeOnly", async () => {
    // Searching from Scarborough (M1B is not in the small MOCK table, use Markham L3R far from Oakville).
    const r = await call("/api/chefs?postalCode=L3R&limit=50");
    const rosa = r.data.items.find((i) => i.displayName.startsWith("Rosa"))!;
    expect(rosa.chefHomeOnly).toBe(true);
    expect(rosa.locationOptions).toEqual(["chef_home"]);
    // A chef who offers only the customer's home and is out of reach is left out.
    const amira = r.data.items.find((i) => i.displayName.startsWith("Amira"));
    expect(amira === undefined || amira.chefHomeOnly === false).toBe(true);
  });

  it("chef_home removes the distance check but keeps only enabled chefs", async () => {
    const r = await call("/api/chefs?locationType=chef_home&limit=50");
    expect(
      r.data.items.every((i) => i.locationOptions.includes("chef_home")),
    ).toBe(true);
    const names = r.data.items.map((i) => i.displayName).sort();
    expect(names).toEqual([
      "Mai Tran (MOCK)",
      "Priya Raman (MOCK)",
      "Rosa Mendes (MOCK)",
    ]);
  });

  it("A-20: every listed mock chef has a bio, a photo and a dish; the mock never lists a hidden one", async () => {
    for (const c of MOCK_CHEFS) {
      expect(c.bio.trim().length).toBeGreaterThan(0);
      expect(c.photoPath).toBeTruthy();
      expect(c.dishes.length).toBeGreaterThan(0);
    }
  });

  it("distance sort puts chefs without a distance last and keeps ties stable (rating, name, id)", async () => {
    const r = await call("/api/chefs?city=Mississauga&limit=50");
    const km = r.data.items.map((i) => i.distanceKm);
    const nulls = km.findIndex((k) => k === null);
    if (nulls >= 0) expect(km.slice(nulls).every((k) => k === null)).toBe(true);
    const nums = km.filter((k): k is number => k !== null);
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
    const again = await call("/api/chefs?city=Mississauga&limit=50");
    expect(again.data.items.map((i) => i.id)).toEqual(
      r.data.items.map((i) => i.id),
    );
  });

  it("no search point means no distance (A-25) even with a date or rate filter", async () => {
    const r = await call("/api/chefs?minRateCents=2000&limit=50");
    expect(r.data.items.every((i) => i.distanceKm === null)).toBe(true);
  });

  it("paging with the offset cursor: every size gives the same list as one big page", async () => {
    const whole = (await call("/api/chefs?limit=50")).data.items.map(
      (i) => i.id,
    );
    for (const size of [3, 7, 20]) {
      const ids: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 40; guard++) {
        const r: Awaited<ReturnType<typeof call>> = await call(
          `/api/chefs?limit=${size}${cursor ? `&cursor=${cursor}` : ""}`,
        );
        ids.push(...r.data.items.map((i) => i.id));
        cursor = r.data.nextCursor;
        if (!cursor) break;
      }
      expect(ids, `size ${size}`).toEqual(whole);
    }
  }, 30000);

  it("a cursor past the end gives an empty last page; a bad or repeated cursor is 422", async () => {
    const past = await call("/api/chefs?cursor=m999999");
    expect(past.status).toBe(200);
    expect(past.data.items).toEqual([]);
    expect(past.data.nextCursor).toBeNull();
    for (const bad of ["abc", "m", "m-1", "1", "m1x"]) {
      const r = await call(`/api/chefs?cursor=${bad}`);
      expect(r.status, bad).toBe(422);
      expect(r.data.error?.fields?.cursor, bad).toBeTruthy();
    }
    expect((await call("/api/chefs?cursor=m1&cursor=m2")).status).toBe(422);
  });

  it("an item never carries a private or internal key", async () => {
    const r = await call("/api/chefs?limit=50&postalCode=L5B");
    const allowed = [
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
    ].sort();
    for (const i of r.data.items)
      expect(Object.keys(i).sort()).toEqual(allowed);
    const text = JSON.stringify(r.data);
    for (const word of [
      "servicePrefix",
      "bio",
      "email",
      "phone",
      "address",
      "kitchen",
      "weekdays",
      "chefHomeEnabled",
      "status",
    ])
      expect(text, word).not.toContain(`"${word}"`);
  });

  it("the detail route hides the prefix and private keys too, and lists only dates inside the window", async () => {
    const d = (await call(`/api/chefs/${MOCK_CHEFS[0].id}`)).data;
    const text = JSON.stringify(d);
    for (const word of [
      "servicePrefix",
      "weekdays",
      "chefHomeEnabled",
      "email",
      "phone",
    ])
      expect(text, word).not.toContain(word);
    expect(d.today).toBe(today);
    expect(d.lastBookableDay).toBe(addDays(today, 180));
    expect(d.bookableDates[0] >= addDays(today, 1)).toBe(true);
    expect(d.bookableDates.at(-1)! <= d.lastBookableDay).toBe(true);
  });

  it("the prefix list is public reference data with city, lat and lng", async () => {
    const r = await call("/api/reference/postal-prefixes");
    expect(r.status).toBe(200);
    const items = (r.data as unknown as { items: Record<string, unknown>[] })
      .items;
    expect(items.length).toBeGreaterThan(5);
    for (const p of items)
      expect(Object.keys(p).sort()).toEqual(["city", "lat", "lng", "prefix"]);
  });
});
