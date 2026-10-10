// MOCK SEARCH ROUTES (T-040). Stand in for the three public routes of docs/api-contract.md
// section 7 (GET /api/chefs, GET /api/chefs/:id, GET /api/reference/postal-prefixes) until the
// browser talks to the real ones. Nothing here is real: the chefs, ratings and dishes are made up,
// and no photo exists (a photo path is only a name; the page shows its "no photo" fallback).
//
// The rules are the real pure functions: query parsing, the A-18 reach rule, A-20, A-17, distance
// sort and the response shape come from src/lib/domain/search.ts. Two differences:
//   - the cursor is a plain offset ("m<number>"), because the real cursor code uses Node's Buffer;
//   - the postal-area list is a small copy of the GTA table in supabase/seed.sql.
// Magic input: the cuisine "explode" answers 500 INTERNAL (to try the error state).
import type {
  ApiError,
  ApiErrorCode,
  LocationType,
  PostalPrefixListResponse,
  PublicChefDetail,
  PublicDish,
} from "@/lib/api/types";
import { weekday } from "@/lib/chef/calendar";
import {
  AVAILABILITY_HORIZON_DAYS,
  addDays,
  isRealDate,
  torontoToday,
} from "@/lib/domain/dishes";
import {
  parseSearchQuery,
  publicLocationOptions,
  rankChefs,
  type ChefCandidate,
  type PrefixRow,
} from "@/lib/domain/search";

/** A small slice of the GTA table (same rows as supabase/seed.sql). */
export const MOCK_PREFIXES: PrefixRow[] = [
  { prefix: "L4W", city: "Mississauga", lat: 43.641, lng: -79.617 },
  { prefix: "L5A", city: "Mississauga", lat: 43.58, lng: -79.6 },
  { prefix: "L5B", city: "Mississauga", lat: 43.592, lng: -79.642 },
  { prefix: "L5C", city: "Mississauga", lat: 43.572, lng: -79.654 },
  { prefix: "L5N", city: "Mississauga", lat: 43.595, lng: -79.74 },
  { prefix: "M2N", city: "Toronto", lat: 43.769, lng: -79.409 },
  { prefix: "M4K", city: "Toronto", lat: 43.679, lng: -79.352 },
  { prefix: "M5V", city: "Toronto", lat: 43.64, lng: -79.399 },
  { prefix: "L6P", city: "Brampton", lat: 43.79, lng: -79.69 },
  { prefix: "L6T", city: "Brampton", lat: 43.71, lng: -79.7 },
  { prefix: "L6H", city: "Oakville", lat: 43.475, lng: -79.7 },
  { prefix: "L6J", city: "Oakville", lat: 43.44, lng: -79.67 },
  { prefix: "L3R", city: "Markham", lat: 43.845, lng: -79.33 },
  { prefix: "L4K", city: "Vaughan", lat: 43.81, lng: -79.51 },
  { prefix: "L4B", city: "Richmond Hill", lat: 43.85, lng: -79.39 },
];

const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const photo = (n: number) =>
  `${uid(n)}/photo-aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}.png`;

interface MockChef extends ChefCandidate {
  bio: string;
  /** Weekdays (0 = Sunday) this MOCK chef ticks, standing in for the availability calendar. */
  weekdays: number[];
  dishes: PublicDish[];
}

function dish(
  chef: number,
  n: number,
  name: string,
  cuisine: string,
  cookMinutes: number,
  allergens: string[],
): PublicDish {
  return {
    id: `00000000-0000-4000-8000-${String(chef * 10 + n).padStart(12, "d")}`,
    name,
    photoPath: null,
    description: `MOCK: ${name}, cooked fresh.`,
    cuisine,
    cookMinutes,
    ingredientCostCents: 1800 + n * 400,
    servings: 4,
    allergens,
    shelfLifeDays: 2,
  };
}

function chef(
  n: number,
  o: Omit<
    MockChef,
    | "id"
    | "photoPath"
    | "currency"
    | "activeDishes"
    | "dishes"
    | "weekdays"
    | "chefHomeEnabled"
  > & {
    dishes: PublicDish[];
    weekdays?: number[];
    chefHomeEnabled?: boolean;
  },
): MockChef {
  return {
    ...o,
    id: uid(1000 + n),
    photoPath: photo(1000 + n),
    currency: "CAD",
    chefHomeEnabled: o.chefHomeEnabled ?? false,
    weekdays: o.weekdays ?? [0, 1, 2, 3, 4, 5, 6],
    activeDishes: o.dishes.map((d) => ({ allergens: d.allergens })),
  };
}

/** MOCK approved chefs. Pending, rejected and incomplete chefs are never part of this list. */
export const MOCK_CHEFS: MockChef[] = [
  chef(1, {
    displayName: "Mai Tran (MOCK)",
    bio: "MOCK: Northern Vietnamese home cooking, pho and bun cha, the way my grandmother made it.",
    cuisines: ["Vietnamese"],
    languages: ["English", "Vietnamese"],
    hourlyRateCents: 2800,
    ratingAvg: 4.8,
    reviewCount: 14,
    servicePrefix: "L5B",
    serviceRadiusKm: 25,
    locationOptions: ["customer_home", "chef_home"],
    chefHomeEnabled: true,
    dishes: [
      dish(1, 1, "Pho bo", "Vietnamese", 180, ["soy"]),
      dish(1, 2, "Goi cuon (fresh rolls)", "Vietnamese", 60, ["shellfish"]),
    ],
  }),
  chef(2, {
    displayName: "Linh Nguyen (MOCK)",
    bio: "MOCK: Southern Vietnamese comfort food. Banh xeo, canh chua and more.",
    cuisines: ["Vietnamese", "Thai"],
    languages: ["English", "Vietnamese", "French"],
    hourlyRateCents: 3200,
    ratingAvg: 4.6,
    reviewCount: 9,
    servicePrefix: "L5N",
    serviceRadiusKm: 20,
    locationOptions: ["customer_home"],
    weekdays: [1, 3, 5, 6],
    dishes: [
      dish(2, 1, "Banh xeo", "Vietnamese", 90, ["eggs"]),
      dish(2, 2, "Canh chua", "Vietnamese", 75, ["fish"]),
    ],
  }),
  chef(3, {
    displayName: "Priya Raman (MOCK)",
    bio: "MOCK: South Indian vegetarian meals: dosa batter, sambar, thorans.",
    cuisines: ["Indian", "South Indian"],
    languages: ["English", "Tamil", "Hindi"],
    hourlyRateCents: 2500,
    ratingAvg: 4.9,
    reviewCount: 21,
    servicePrefix: "L6P",
    serviceRadiusKm: 30,
    locationOptions: ["customer_home", "chef_home"],
    chefHomeEnabled: true,
    dishes: [
      dish(3, 1, "Sambar and idli", "Indian", 120, ["gluten"]),
      dish(3, 2, "Vegetable thoran", "Indian", 45, []),
    ],
  }),
  chef(4, {
    displayName: "Wei Zhang (MOCK)",
    bio: "MOCK: Cantonese soups and steamed fish for the whole week.",
    cuisines: ["Cantonese", "Chinese"],
    languages: ["English", "Cantonese", "Mandarin"],
    hourlyRateCents: 3500,
    ratingAvg: 4.4,
    reviewCount: 6,
    servicePrefix: "L3R",
    serviceRadiusKm: 15,
    locationOptions: ["customer_home"],
    weekdays: [2, 4, 6],
    dishes: [
      dish(4, 1, "Steamed fish", "Cantonese", 60, ["fish", "soy"]),
      dish(4, 2, "Winter melon soup", "Cantonese", 150, []),
    ],
  }),
  chef(5, {
    displayName: "Rosa Mendes (MOCK)",
    bio: "MOCK: Portuguese home cooking from Oakville: caldo verde and bacalhau.",
    cuisines: ["Portuguese"],
    languages: ["English", "Portuguese"],
    hourlyRateCents: 3000,
    ratingAvg: 4.7,
    reviewCount: 11,
    servicePrefix: "L6H",
    serviceRadiusKm: 12,
    // Only cooks at her own kitchen: shown as "Chef's home only" (A-18) for customers elsewhere.
    locationOptions: ["chef_home"],
    chefHomeEnabled: true,
    dishes: [dish(5, 1, "Caldo verde", "Portuguese", 90, [])],
  }),
  chef(6, {
    displayName: "Amira Haddad (MOCK)",
    bio: "MOCK: Lebanese mezze and slow-cooked stews from Toronto.",
    cuisines: ["Lebanese", "Middle Eastern"],
    languages: ["English", "Arabic"],
    hourlyRateCents: 3300,
    ratingAvg: 4.5,
    reviewCount: 4,
    servicePrefix: "M4K",
    serviceRadiusKm: 18,
    locationOptions: ["customer_home"],
    dishes: [
      dish(6, 1, "Hummus and falafel", "Lebanese", 100, ["sesame"]),
      dish(6, 2, "Kafta stew", "Lebanese", 120, []),
    ],
  }),
  chef(7, {
    displayName: "Kofi Mensah (MOCK)",
    bio: "MOCK: Ghanaian jollof, groundnut soup and kelewele.",
    cuisines: ["Ghanaian", "West African"],
    languages: ["English", "Twi"],
    hourlyRateCents: 2200,
    ratingAvg: 0,
    reviewCount: 0,
    servicePrefix: "L5A",
    serviceRadiusKm: 20,
    locationOptions: ["customer_home"],
    dishes: [dish(7, 1, "Jollof rice", "Ghanaian", 90, ["peanuts"])],
  }),
  chef(8, {
    displayName: "Sofia Rossi (MOCK)",
    bio: "MOCK: Northern Italian pasta, risotto and weekday sauces.",
    cuisines: ["Italian"],
    languages: ["English", "Italian"],
    hourlyRateCents: 4200,
    ratingAvg: 4.3,
    reviewCount: 3,
    servicePrefix: "L4K",
    serviceRadiusKm: 25,
    locationOptions: ["customer_home"],
    dishes: [dish(8, 1, "Mushroom risotto", "Italian", 70, ["milk"])],
  }),
];

// More approved chefs so that "Load more" has a second page (the page size is 20). They cook a
// made-up cuisine, so searches for real cuisines are not affected.
const FILLER_CITIES = ["L5A", "L5C", "L4W", "L6T", "L4B", "M5V"] as const;
for (let i = 1; i <= 14; i++) {
  MOCK_CHEFS.push(
    chef(100 + i, {
      displayName: `Extra Cook ${String(i).padStart(2, "0")} (MOCK)`,
      bio: "MOCK: a filler chef so that the list has more than one page.",
      cuisines: ["Test Kitchen"],
      languages: ["English"],
      hourlyRateCents: 2000 + i * 50,
      ratingAvg: 3 + (i % 5) / 5,
      reviewCount: i,
      servicePrefix: FILLER_CITIES[i % FILLER_CITIES.length],
      serviceRadiusKm: 40,
      locationOptions: ["customer_home"],
      dishes: [dish(100 + i, 1, "Plain rice", "Test Kitchen", 30, [])],
    }),
  );
}

function json(status: number, body: unknown, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
function fail(
  status: number,
  code: ApiErrorCode,
  message: string,
  fields?: Record<string, string>,
) {
  const body: ApiError = { error: { code, message, fields } };
  return json(status, body);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NOT_FOUND = () => fail(404, "NOT_FOUND", "Chef not found.");

/** Returns a response when `path` is one of the three public routes, else null. */
export function searchRoutes(method: string, path: string): Response | null {
  const url = new URL(path, "http://mock.invalid");
  const p = url.pathname;
  const isList = p === "/api/chefs";
  const detail = /^\/api\/chefs\/([^/]+)$/.exec(p);
  const isPrefixes = p === "/api/reference/postal-prefixes";
  if (!isList && !detail && !isPrefixes) return null;
  if (method !== "GET") return fail(404, "NOT_FOUND", "Not found.");

  if (isPrefixes)
    return json(200, {
      items: MOCK_PREFIXES.map((x) => ({ ...x })),
    } satisfies PostalPrefixListResponse);

  const today = torontoToday();
  if (detail) {
    const id = decodeURIComponent(detail[1]);
    const c = UUID.test(id) ? MOCK_CHEFS.find((x) => x.id === id) : undefined;
    if (!c) return NOT_FOUND();
    return json(200, detailOf(c, today));
  }

  // List. The cursor is an offset in this MOCK, so it is read here and kept away from the real
  // parser (whose cursor needs Node's Buffer).
  const params = new URLSearchParams(url.search);
  const cursors = params.getAll("cursor");
  params.delete("cursor");
  if (
    params.getAll("cuisine").some((v) => v.trim().toLowerCase() === "explode")
  )
    return fail(500, "INTERNAL", "Something went wrong on our side.");

  const parsed = parseSearchQuery(params, { today, prefixes: MOCK_PREFIXES });
  const errors = { ...parsed.errors };
  let offset = 0;
  if (cursors.length > 1) errors.cursor = "Send this only once.";
  else if (cursors.length === 1 && cursors[0] !== "") {
    const m = /^m(\d{1,6})$/.exec(cursors[0]);
    if (m) offset = Number(m[1]);
    else errors.cursor = "That page marker is not valid.";
  }
  if (Object.keys(errors).length || !parsed.value)
    return fail(
      422,
      "VALIDATION_FAILED",
      "Check the highlighted fields.",
      errors,
    );

  const q = parsed.value;
  const last = addDays(today, AVAILABILITY_HORIZON_DAYS);
  let pool: MockChef[] = MOCK_CHEFS;
  if (q.date) {
    const d = q.date;
    // The chef ticked that date (A-19). Real dates only; inside the window (the parser checked).
    pool = pool.filter(
      (c) =>
        isRealDate(d) &&
        d >= today &&
        d <= last &&
        c.weekdays.includes(weekday(d)),
    );
  }
  // Rank everything in one go (limit raised) and page here with the offset cursor.
  const all = rankChefs(
    pool,
    { ...q, cursor: null, limit: 1000 },
    MOCK_PREFIXES,
  );
  const items = all.items.slice(offset, offset + q.limit);
  const next = offset + q.limit;
  return json(200, {
    items,
    nextCursor: next < all.items.length ? `m${next}` : null,
  });
}

function detailOf(c: MockChef, today: string): PublicChefDetail {
  const last = addDays(today, AVAILABILITY_HORIZON_DAYS);
  const bookableDates: string[] = [];
  for (let d = today; d <= last; d = addDays(d, 1))
    if (c.weekdays.includes(weekday(d))) bookableDates.push(d);
  const prefix = MOCK_PREFIXES.find((x) => x.prefix === c.servicePrefix);
  const options: LocationType[] = publicLocationOptions(
    c.locationOptions,
    c.chefHomeEnabled,
  );
  return {
    id: c.id,
    displayName: c.displayName,
    bio: c.bio,
    photoPath: c.photoPath as string,
    cuisines: c.cuisines,
    languages: c.languages,
    hourlyRateCents: c.hourlyRateCents,
    currency: c.currency,
    ratingAvg: c.ratingAvg,
    reviewCount: c.reviewCount,
    serviceCity: prefix?.city ?? null,
    serviceRadiusKm: c.serviceRadiusKm,
    locationOptions: options,
    dishes: c.dishes,
    bookableDates,
    today,
    lastBookableDay: last,
  };
}
