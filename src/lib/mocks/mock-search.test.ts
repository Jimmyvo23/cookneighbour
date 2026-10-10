import { describe, expect, it } from "vitest";
import type {
  PostalPrefixListResponse,
  PublicChefDetail,
  PublicChefSearchResponse,
} from "@/lib/api/types";
import { mockFetch } from "@/lib/mocks/mock-adapter";
import { MOCK_CHEFS } from "@/lib/mocks/mock-search";
import { torontoToday } from "@/lib/domain/dishes";

const H = { "Content-Type": "application/json" };
async function get(path: string) {
  const res = await mockFetch(path, { method: "GET", headers: H });
  return { status: res.status, data: await res.json() };
}
const list = async (qs = "") =>
  (await get(`/api/chefs${qs}`)) as {
    status: number;
    data: PublicChefSearchResponse & {
      error?: { fields?: Record<string, string> };
    };
  };

describe("MOCK search routes (contract section 7)", () => {
  it("answers without a session", async () => {
    const r = await list();
    expect(r.status).toBe(200);
    expect(r.data.items.length).toBe(MOCK_CHEFS.length);
  });

  it("without a location sorts by rating, then name, and has no distance (A-25)", async () => {
    const { items } = (await list()).data;
    expect(items.every((i) => i.distanceKm === null)).toBe(true);
    const ratings = items.map((i) => i.ratingAvg);
    expect(ratings).toEqual([...ratings].sort((a, b) => b - a));
  });

  it("sorts by distance from a postal code, nearest first", async () => {
    const { items } = (
      await list("?postalCode=L5B+1A1&locationType=customer_home")
    ).data;
    const km = items.map((i) => i.distanceKm as number);
    expect(km.every((k) => typeof k === "number")).toBe(true);
    expect(km).toEqual([...km].sort((a, b) => a - b));
    expect(items[0].displayName).toContain("Mai Tran");
  });

  it("finds a Vietnamese chef in Mississauga (the demo step)", async () => {
    const { items } = (await list("?city=Mississauga&cuisine=vietnamese")).data;
    expect(items.map((i) => i.displayName)).toEqual([
      "Mai Tran (MOCK)",
      "Linh Nguyen (MOCK)",
    ]);
  });

  it("leaves out chefs out of reach, unless they can be booked at home (A-18)", async () => {
    const { items } = (await list("?postalCode=L5B")).data;
    const names = items.map((i) => i.displayName);
    // Wei (Markham, 15 km radius) is too far; Rosa (Oakville) is out of reach but cooks at home.
    expect(names.some((n) => n.startsWith("Wei"))).toBe(false);
    const rosa = items.find((i) => i.displayName.startsWith("Rosa"));
    expect(rosa?.chefHomeOnly).toBe(true);
    expect(
      items.find((i) => i.displayName.startsWith("Mai"))?.chefHomeOnly,
    ).toBe(false);
  });

  it("chef_home keeps only chefs bookable at their own home", async () => {
    const { items } = (await list("?locationType=chef_home")).data;
    expect(items.map((i) => i.displayName).sort()).toEqual([
      "Mai Tran (MOCK)",
      "Priya Raman (MOCK)",
      "Rosa Mendes (MOCK)",
    ]);
  });

  it("filters by language, price (cents) and allergens to avoid", async () => {
    expect(
      (await list("?language=tamil")).data.items.map((i) => i.displayName),
    ).toEqual(["Priya Raman (MOCK)"]);
    const cheap = (await list("?maxRateCents=2500")).data.items;
    expect(cheap.every((i) => (i.hourlyRateCents as number) <= 2500)).toBe(
      true,
    );
    expect(cheap.length).toBeGreaterThan(0);
    // Kofi's only dish has peanuts, so he is out when peanuts are avoided.
    const avoid = (await list("?avoidAllergens=peanuts")).data.items;
    expect(avoid.some((i) => i.displayName.startsWith("Kofi"))).toBe(false);
  });

  it("filters by a date the chef ticked", async () => {
    const today = torontoToday();
    const all = (await list(`?date=${today}`)).data.items.length;
    expect(all).toBeGreaterThan(0);
    expect(all).toBeLessThanOrEqual(MOCK_CHEFS.length);
  });

  it("pages with a cursor: no repeats, no gaps, last page has no cursor", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const qs: string = `?limit=3${cursor ? `&cursor=${cursor}` : ""}`;
      const { data } = await list(qs);
      seen.push(...data.items.map((i) => i.id));
      cursor = data.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(Math.ceil(MOCK_CHEFS.length / 3));
    expect(new Set(seen).size).toBe(MOCK_CHEFS.length);
  });

  it("reports every field error at once (422)", async () => {
    const r = await list(
      "?postalCode=V6B+1A1&minRateCents=500&maxRateCents=100&date=2020-01-01&locationType=nope",
    );
    expect(r.status).toBe(422);
    expect(Object.keys(r.data.error!.fields!).sort()).toEqual([
      "date",
      "locationType",
      "maxRateCents",
      "postalCode",
    ]);
  });

  it("rejects a bad cursor, a repeated parameter, and a postal code with a city", async () => {
    expect((await list("?cursor=zzz")).data.error?.fields?.cursor).toBeTruthy();
    expect(
      (await list("?cuisine=a&cuisine=b")).data.error?.fields?.cuisine,
    ).toBeTruthy();
    expect(
      (await list("?city=Toronto&postalCode=L5B")).data.error?.fields?.city,
    ).toBeTruthy();
    expect((await list("?city=Nowhere")).status).toBe(422);
  });

  it("ignores empty and unknown parameters", async () => {
    const r = await list("?cuisine=&nationality=viet&foo=1");
    expect(r.status).toBe(200);
    expect(r.data.items.length).toBe(MOCK_CHEFS.length);
  });

  it("shows only the public item keys", async () => {
    const { items } = (await list()).data;
    expect(Object.keys(items[0]).sort()).toEqual(
      [
        "chefHomeOnly",
        "currency",
        "cuisines",
        "displayName",
        "distanceKm",
        "hourlyRateCents",
        "id",
        "languages",
        "locationOptions",
        "photoPath",
        "ratingAvg",
        "reviewCount",
        "serviceCity",
        "serviceRadiusKm",
      ].sort(),
    );
  });

  it("the magic cuisine 'explode' answers 500", async () => {
    expect((await list("?cuisine=explode")).status).toBe(500);
  });

  it("detail: active dishes, bookable dates, one 404 for everything unknown", async () => {
    const id = MOCK_CHEFS[0].id;
    const r = await get(`/api/chefs/${id}`);
    const d = r.data as PublicChefDetail;
    expect(r.status).toBe(200);
    expect(d.dishes.length).toBeGreaterThan(0);
    expect(d.bookableDates[0] >= d.today).toBe(true);
    expect(d.bookableDates.at(-1)! <= d.lastBookableDay).toBe(true);
    const a = await get("/api/chefs/not-a-uuid");
    const b = await get("/api/chefs/00000000-0000-4000-8000-000000000001");
    expect(a.status).toBe(404);
    expect(b).toEqual(a);
  });

  it("postal prefixes for the city picker", async () => {
    const r = await get("/api/reference/postal-prefixes");
    const d = r.data as PostalPrefixListResponse;
    expect(r.status).toBe(200);
    expect(d.items.find((p) => p.prefix === "L5B")?.city).toBe("Mississauga");
  });
});
