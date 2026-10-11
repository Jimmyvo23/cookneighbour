// Public chef search rules (T-039, contract section 7). Pure functions, no I/O: the route loads the
// rows and this module decides who matches, what is shown and in which order.
//
// Rules, all from PLAN.md (assumptions Jimmy may change):
//   A-1   distance is straight-line (haversine) between postal-area centres
//   A-17  "dietary needs" means allergen exclusion (chefMatchesDietary)
//   A-18  a city search uses the average of that city's area centres; out-of-reach chefs stay only
//         when they can be booked at their own home, marked chef's-home only
//   A-20  an approved chef with no bio, no photo or no active dish is not public (interim for Q-13)
//   D-15  the date filter must fall inside the booking window (today to today + 180, Toronto)
import type {
  LocationType,
  PublicChefSearchItem,
  PublicChefSearchResponse,
} from "@/lib/api/types";
import { hasUnsafeText } from "./text-safety";
import { chefMatchesDietary } from "./dietary";
import { centreForPostal, distanceMetres, type LatLng } from "./distance";
import { AVAILABILITY_HORIZON_DAYS, addDays, isRealDate } from "./dishes";

export interface PrefixRow {
  prefix: string;
  city: string;
  lat: number;
  lng: number;
}

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
export const MAX_AVOID_ALLERGENS = 14;
export const TEXT_MAX = 40;
export const RATE_MAX_CENTS = 100000;
const CURSOR_MAX = 600;

const norm = (s: string) => s.trim().toLowerCase();

// ---------------------------------------------------------------------------
// Cursor (keyset over the sort key, opaque to clients)
// ---------------------------------------------------------------------------
export interface CursorKey {
  /** Distance in whole metres; null when there is no distance. */
  m: number | null;
  r: number;
  n: string;
  i: string;
}

export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

/** Strict: anything that is not exactly a key this module made returns null. */
export function decodeCursor(raw: string): CursorKey | null {
  if (!raw || raw.length > CURSOR_MAX || !/^[A-Za-z0-9_-]+$/.test(raw))
    return null;
  try {
    const v: unknown = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    );
    if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).sort().join(",");
    if (keys !== "i,m,n,r") return null;
    if (typeof o.i !== "string" || typeof o.n !== "string") return null;
    if (typeof o.r !== "number" || !Number.isFinite(o.r)) return null;
    if (o.m !== null && (typeof o.m !== "number" || !Number.isFinite(o.m)))
      return null;
    return { m: o.m as number | null, r: o.r, n: o.n, i: o.i };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------
export interface SearchQuery {
  point: LatLng | null;
  cuisine?: string;
  language?: string;
  /** Lower case, trimmed, distinct. */
  avoid: string[];
  minRateCents?: number;
  maxRateCents?: number;
  date?: string;
  locationType?: LocationType;
  limit: number;
  cursor: CursorKey | null;
}

export interface SearchContext {
  /** Toronto today, from the server clock. */
  today: string;
  prefixes: readonly PrefixRow[];
}

export function prefixCentres(prefixes: readonly PrefixRow[]) {
  return new Map(
    prefixes.map((p) => [p.prefix, { lat: p.lat, lng: p.lng }] as const),
  );
}

/** A-18: the mean of the centres of the city's areas, or null for an unknown city. */
export function cityCentre(
  prefixes: readonly PrefixRow[],
  city: string,
): LatLng | null {
  const wanted = norm(city);
  const rows = prefixes.filter((p) => norm(p.city) === wanted);
  if (rows.length === 0) return null;
  return {
    lat: rows.reduce((s, r) => s + r.lat, 0) / rows.length,
    lng: rows.reduce((s, r) => s + r.lng, 0) / rows.length,
  };
}

export function parseSearchQuery(
  params: URLSearchParams,
  ctx: SearchContext,
): { value?: SearchQuery; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  /** One trimmed value; "" when absent or blank. A repeated parameter is an error. */
  const one = (key: string): string => {
    const all = params.getAll(key);
    if (all.length > 1) {
      errors[key] = "Send this only once.";
      return "";
    }
    return (all[0] ?? "").trim();
  };
  const text = (key: string): string | undefined => {
    const v = one(key);
    if (!v || errors[key]) return undefined;
    if (v.length > TEXT_MAX) {
      errors[key] = `Use ${TEXT_MAX} characters or fewer.`;
      return undefined;
    }
    if (hasUnsafeText(v)) {
      errors[key] = "Remove control or invalid characters.";
      return undefined;
    }
    return v;
  };
  const cents = (key: string): number | undefined => {
    const v = one(key);
    if (!v || errors[key]) return undefined;
    if (!/^\d{1,9}$/.test(v) || Number(v) > RATE_MAX_CENTS) {
      errors[key] = `Use a whole number of cents from 0 to ${RATE_MAX_CENTS}.`;
      return undefined;
    }
    return Number(v);
  };

  // Location: a postal code or a city, never both.
  const postal = one("postalCode");
  const city = one("city");
  let point: LatLng | null = null;
  if (postal && city) {
    errors.city = "Send either postalCode or city, not both.";
  } else if (postal) {
    if (!errors.postalCode) {
      point = centreForPostal(prefixCentres(ctx.prefixes), postal);
      if (!point) errors.postalCode = "Not a GTA postal code.";
    }
  } else if (city) {
    if (!errors.city) {
      point = cityCentre(ctx.prefixes, city);
      if (!point) errors.city = "Not a GTA city.";
    }
  }

  const cuisine = text("cuisine");
  const language = text("language");

  let avoid: string[] = [];
  const avoidRaw = one("avoidAllergens");
  if (avoidRaw && !errors.avoidAllergens) {
    const parts = avoidRaw.split(",").map(norm).filter(Boolean);
    avoid = [...new Set(parts)];
    if (avoid.length > MAX_AVOID_ALLERGENS)
      errors.avoidAllergens = `Use up to ${MAX_AVOID_ALLERGENS} allergens.`;
    else if (avoid.some((a) => a.length > TEXT_MAX))
      errors.avoidAllergens = `Each allergen is up to ${TEXT_MAX} characters.`;
    else if (avoid.some((a) => hasUnsafeText(a)))
      errors.avoidAllergens = "Remove control or invalid characters.";
  }

  const minRateCents = cents("minRateCents");
  const maxRateCents = cents("maxRateCents");
  if (
    minRateCents !== undefined &&
    maxRateCents !== undefined &&
    minRateCents > maxRateCents
  )
    errors.maxRateCents = "The highest rate must not be below the lowest.";

  let date: string | undefined;
  const dateRaw = one("date");
  if (dateRaw && !errors.date) {
    const last = addDays(ctx.today, AVAILABILITY_HORIZON_DAYS);
    // D-27: no same-day bookings, so the first date a customer can search is tomorrow.
    const first = addDays(ctx.today, 1);
    if (!isRealDate(dateRaw) || dateRaw < first || dateRaw > last)
      errors.date = `Pick a date from ${first} to ${last} (YYYY-MM-DD).`;
    else date = dateRaw;
  }

  let locationType: LocationType | undefined;
  const lt = one("locationType");
  if (lt && !errors.locationType) {
    if (lt === "customer_home" || lt === "chef_home") locationType = lt;
    else errors.locationType = "Use customer_home or chef_home.";
  }

  let limit = DEFAULT_LIMIT;
  const limitRaw = one("limit");
  if (limitRaw && !errors.limit) {
    if (
      !/^\d{1,3}$/.test(limitRaw) ||
      Number(limitRaw) < 1 ||
      Number(limitRaw) > MAX_LIMIT
    )
      errors.limit = `Use a whole number from 1 to ${MAX_LIMIT}.`;
    else limit = Number(limitRaw);
  }

  let cursor: CursorKey | null = null;
  const cursorRaw = one("cursor");
  if (cursorRaw && !errors.cursor) {
    cursor = decodeCursor(cursorRaw);
    if (!cursor) errors.cursor = "That page marker is not valid.";
  }

  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    value: {
      point,
      cuisine,
      language,
      avoid,
      minRateCents,
      maxRateCents,
      date,
      locationType,
      limit,
      cursor,
    },
  };
}

// ---------------------------------------------------------------------------
// Visibility and location rules
// ---------------------------------------------------------------------------
/** A-20: what an approved chef needs before the public may see them. */
export function isListable(c: {
  bio: string | null;
  photoPath: string | null;
  activeDishCount: number;
}): boolean {
  return (
    !!c.bio &&
    c.bio.trim().length > 0 &&
    !!c.photoPath &&
    c.photoPath.length > 0 &&
    c.activeDishCount > 0
  );
}

/** chef_home is public only when the chef offers it and an admin approved the kitchen. */
export function publicLocationOptions(
  options: readonly LocationType[],
  chefHomeEnabled: boolean,
): LocationType[] {
  return options.filter((o) => o !== "chef_home" || chefHomeEnabled);
}

export interface LocationFacts {
  options: readonly LocationType[];
  chefHomeEnabled: boolean;
  radiusKm: number;
}

/**
 * Reach and chef's-home rule (A-18).
 * - reachable at the customer's home: offers customer_home and, when there is a search point,
 *   the distance is within the service radius;
 * - bookable at the chef's home: offers chef_home AND chef_home_enabled.
 * `locationType` customer_home or absent keeps reachable chefs and out-of-reach chefs who are
 * bookable at home (marked chefHomeOnly); chef_home keeps only chefs bookable at home.
 */
export function evaluateLocation(
  c: LocationFacts,
  distanceKm: number | null,
  hasPoint: boolean,
  locationType: LocationType | undefined,
): { include: boolean; chefHomeOnly: boolean } {
  const offersCustomerHome = c.options.includes("customer_home");
  const homeBookable = c.options.includes("chef_home") && c.chefHomeEnabled;
  const reachable =
    offersCustomerHome &&
    (!hasPoint || (distanceKm !== null && distanceKm <= c.radiusKm));
  const include =
    locationType === "chef_home" ? homeBookable : reachable || homeBookable;
  return { include, chefHomeOnly: !reachable };
}

// ---------------------------------------------------------------------------
// Filtering, sorting, paging
// ---------------------------------------------------------------------------
export interface ChefCandidate {
  id: string;
  displayName: string;
  bio: string | null;
  photoPath: string | null;
  cuisines: string[];
  languages: string[];
  hourlyRateCents: number | null;
  currency: string;
  ratingAvg: number;
  reviewCount: number;
  servicePrefix: string | null;
  serviceRadiusKm: number;
  locationOptions: LocationType[];
  chefHomeEnabled: boolean;
  /** Active dishes only. */
  activeDishes: { allergens: string[] }[];
}

interface Ranked {
  item: PublicChefSearchItem;
  key: CursorKey;
}

function compareKeys(a: CursorKey, b: CursorKey): number {
  if (a.m !== b.m) {
    if (a.m === null) return 1;
    if (b.m === null) return -1;
    return a.m - b.m;
  }
  if (a.r !== b.r) return b.r - a.r;
  if (a.n !== b.n) return a.n < b.n ? -1 : 1;
  if (a.i !== b.i) return a.i < b.i ? -1 : 1;
  return 0;
}

export function rankChefs(
  candidates: readonly ChefCandidate[],
  query: SearchQuery,
  prefixes: readonly PrefixRow[],
): PublicChefSearchResponse {
  const byPrefix = new Map(prefixes.map((p) => [p.prefix, p] as const));
  const cuisine = query.cuisine ? norm(query.cuisine) : null;
  const language = query.language ? norm(query.language) : null;
  const hasRateBound =
    query.minRateCents !== undefined || query.maxRateCents !== undefined;
  const ranked: Ranked[] = [];

  for (const c of candidates) {
    if (
      !isListable({
        bio: c.bio,
        photoPath: c.photoPath,
        activeDishCount: c.activeDishes.length,
      })
    )
      continue;
    if (cuisine && !c.cuisines.some((x) => norm(x) === cuisine)) continue;
    if (language && !c.languages.some((x) => norm(x) === language)) continue;
    if (hasRateBound) {
      if (c.hourlyRateCents === null) continue;
      if (
        query.minRateCents !== undefined &&
        c.hourlyRateCents < query.minRateCents
      )
        continue;
      if (
        query.maxRateCents !== undefined &&
        c.hourlyRateCents > query.maxRateCents
      )
        continue;
    }
    if (
      !chefMatchesDietary(
        c.activeDishes.map((d) => ({ isActive: true, allergens: d.allergens })),
        query.avoid,
      )
    )
      continue;

    const home = c.servicePrefix ? byPrefix.get(c.servicePrefix) : undefined;
    const metres =
      query.point && home
        ? distanceMetres(query.point, { lat: home.lat, lng: home.lng })
        : null;
    const loc = evaluateLocation(
      {
        options: c.locationOptions,
        chefHomeEnabled: c.chefHomeEnabled,
        radiusKm: c.serviceRadiusKm,
      },
      metres === null ? null : metres / 1000,
      query.point !== null,
      query.locationType,
    );
    if (!loc.include) continue;

    ranked.push({
      key: { m: metres, r: c.ratingAvg, n: c.displayName, i: c.id },
      item: {
        id: c.id,
        displayName: c.displayName,
        photoPath: c.photoPath as string,
        cuisines: c.cuisines,
        languages: c.languages,
        hourlyRateCents: c.hourlyRateCents,
        currency: c.currency,
        ratingAvg: c.ratingAvg,
        reviewCount: c.reviewCount,
        serviceCity: home?.city ?? null,
        serviceRadiusKm: c.serviceRadiusKm,
        distanceKm: metres === null ? null : Math.round(metres / 100) / 10,
        locationOptions: publicLocationOptions(
          c.locationOptions,
          c.chefHomeEnabled,
        ),
        chefHomeOnly: loc.chefHomeOnly,
      },
    });
  }

  // Without a search point every distance is null, so the order is rating, name, id.
  ranked.sort((a, b) => compareKeys(a.key, b.key));

  let start = 0;
  if (query.cursor) {
    const after = query.cursor;
    start = ranked.findIndex((r) => compareKeys(r.key, after) > 0);
    if (start === -1) start = ranked.length;
  }
  const page = ranked.slice(start, start + query.limit);
  const hasMore = start + query.limit < ranked.length;
  return {
    items: page.map((r) => r.item),
    nextCursor: hasMore ? encodeCursor(page[page.length - 1].key) : null,
  };
}
