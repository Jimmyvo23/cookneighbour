// Pure helpers for the customer search page (T-040). The server stays the authority (contract
// section 7); these only build the request, give quick feedback before it is sent, and format
// results. Nothing here touches the network or the DOM.
import type {
  LocationType,
  PostalPrefix,
  PublicChefSearchItem,
  PublicChefSearchQuery,
} from "@/lib/api/types";
import { dollarsToCents } from "@/lib/chef/form";
import {
  addDays,
  AVAILABILITY_HORIZON_DAYS,
  isRealDate,
} from "@/lib/domain/dishes";
import { centreForPostal, type LatLng } from "@/lib/domain/distance";

export type FieldErrors = Record<string, string>;

/** The form as typed: every value is text, rates are dollars. */
export interface SearchFormValues {
  postalCode: string;
  city: string;
  cuisine: string;
  language: string;
  /** Allergens to avoid (A-17), lower case, from the checkbox group. */
  avoidAllergens: string[];
  minRate: string;
  maxRate: string;
  date: string;
  locationType: LocationType;
}

export const emptySearchForm = (): SearchFormValues => ({
  postalCode: "",
  city: "",
  cuisine: "",
  language: "",
  avoidAllergens: [],
  minRate: "",
  maxRate: "",
  date: "",
  locationType: "customer_home",
});

export const PAGE_SIZE = 20;
export const RATE_MAX_DOLLARS = 1000; // the API accepts 0 to 100000 cents
const TEXT_MAX = 40;
/** Same ceiling as the API, so a hand-edited URL cannot ask for an absurd list. */
const AVOID_MAX = 14;

/** The booking window the API allows (D-15): today to today + 180 days, Toronto. The server's
 *  answer is final; this only sets the date picker's limits and a quick message. */
export function dateWindow(today: string): { min: string; max: string } {
  return { min: today, max: addDays(today, AVAILABILITY_HORIZON_DAYS) };
}

/** Quick checks before sending. Returns field errors keyed like the API's `fields`. */
export function validateSearchForm(
  v: SearchFormValues,
  ctx: { today: string; prefixes: readonly PostalPrefix[] | null },
): FieldErrors {
  const e: FieldErrors = {};
  const postal = v.postalCode.trim();
  const city = v.city.trim();
  if (postal && city) {
    e.city = "Use a postal code or a city, not both.";
  } else if (postal) {
    // Only when the list of GTA areas loaded; otherwise the server decides.
    if (ctx.prefixes) {
      const centres = new Map(
        ctx.prefixes.map((p) => [p.prefix, { lat: p.lat, lng: p.lng }]),
      );
      if (!centreForPostal(centres, postal))
        e.postalCode = "Not a GTA postal code. Try one like L5B 1A1 or L5B.";
    } else if (!/^[A-Za-z]\d[A-Za-z]\s?(\d[A-Za-z]\d)?$/.test(postal)) {
      e.postalCode = "Enter a postal code like L5B 1A1 or just L5B.";
    }
  }
  for (const key of ["cuisine", "language"] as const) {
    if (v[key].trim().length > TEXT_MAX)
      e[key] = `Use ${TEXT_MAX} characters or fewer.`;
  }
  const min = v.minRate.trim() ? dollarsToCents(v.minRate) : undefined;
  const max = v.maxRate.trim() ? dollarsToCents(v.maxRate) : undefined;
  const cap = RATE_MAX_DOLLARS * 100;
  const rateMsg = `Enter dollars, for example 25 or 25.50, up to $${RATE_MAX_DOLLARS}.`;
  if (min === null || (min !== undefined && min > cap)) e.minRate = rateMsg;
  if (max === null || (max !== undefined && max > cap)) e.maxRate = rateMsg;
  if (
    !e.minRate &&
    !e.maxRate &&
    typeof min === "number" &&
    typeof max === "number" &&
    min > max
  )
    e.maxRate = "The highest rate must not be below the lowest.";
  if (v.date) {
    const { min: lo, max: hi } = dateWindow(ctx.today);
    if (!isRealDate(v.date) || v.date < lo || v.date > hi)
      e.date = `Pick a date from ${lo} to ${hi}.`;
  }
  if (v.avoidAllergens.length > AVOID_MAX)
    e.avoidAllergens = `Choose up to ${AVOID_MAX} allergens.`;
  return e;
}

/** Form values to the API query. Empty values are left out; dollars become whole cents. */
export function buildQuery(v: SearchFormValues): PublicChefSearchQuery {
  const q: PublicChefSearchQuery = {
    locationType: v.locationType,
    limit: PAGE_SIZE,
  };
  const postal = v.postalCode.trim();
  const city = v.city.trim();
  if (postal) q.postalCode = postal;
  else if (city) q.city = city;
  if (v.cuisine.trim()) q.cuisine = v.cuisine.trim();
  if (v.language.trim()) q.language = v.language.trim();
  if (v.avoidAllergens.length) q.avoidAllergens = v.avoidAllergens.join(",");
  const min = v.minRate.trim() ? dollarsToCents(v.minRate) : null;
  const max = v.maxRate.trim() ? dollarsToCents(v.maxRate) : null;
  if (min !== null) q.minRateCents = min;
  if (max !== null) q.maxRateCents = max;
  if (v.date) q.date = v.date;
  return q;
}

/** Query to a URL query string (stable key order, so the same search gives the same string). */
export function queryString(q: PublicChefSearchQuery, cursor?: string): string {
  const p = new URLSearchParams();
  const keys: (keyof PublicChefSearchQuery)[] = [
    "postalCode",
    "city",
    "cuisine",
    "language",
    "avoidAllergens",
    "minRateCents",
    "maxRateCents",
    "date",
    "locationType",
    "limit",
  ];
  for (const k of keys) {
    const val = q[k];
    if (val !== undefined && val !== "") p.set(k, String(val));
  }
  if (cursor) p.set("cursor", cursor);
  return p.toString();
}

/** API field errors to form field ids (only the keys the form shows). */
export function formErrorsFromApi(fields: Record<string, string>): FieldErrors {
  const out: FieldErrors = {};
  for (const [k, msg] of Object.entries(fields)) {
    const key =
      k === "minRateCents"
        ? "minRate"
        : k === "maxRateCents"
          ? "maxRate"
          : k === "avoidAllergens"
            ? "avoidAllergens"
            : k;
    out[key] = msg;
  }
  return out;
}

/** The order the fields appear in the form, so focus goes to the first one with an error. */
export const FIELD_ORDER = [
  "postalCode",
  "city",
  "cuisine",
  "language",
  "avoidAllergens",
  "minRate",
  "maxRate",
  "date",
  "locationType",
] as const;

export function firstErrorField(errors: FieldErrors): string | null {
  for (const k of FIELD_ORDER) if (errors[k]) return k;
  return Object.keys(errors)[0] ?? null;
}

/** Adds a page to the list. A chef already shown is not shown twice (the order stays). */
export function mergePage(
  shown: readonly PublicChefSearchItem[],
  page: readonly PublicChefSearchItem[],
): { items: PublicChefSearchItem[]; firstNewId: string | null } {
  const seen = new Set(shown.map((i) => i.id));
  const fresh = page.filter((i) => !seen.has(i.id));
  return {
    items: [...shown, ...fresh],
    firstNewId: fresh[0]?.id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
export function rateText(cents: number | null, currency = "CAD"): string {
  if (cents === null) return "Rate not set";
  const dollars = cents / 100;
  const text = Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
  return `$${text}/hour${currency === "CAD" ? "" : ` ${currency}`}`;
}

export function distanceText(km: number | null): string | null {
  return km === null ? null : `${km.toFixed(1)} km away`;
}

export function ratingText(avg: number, count: number): string {
  if (count === 0) return "No reviews yet";
  return `${avg.toFixed(1)} out of 5 (${count} ${count === 1 ? "review" : "reviews"})`;
}

export function locationText(item: PublicChefSearchItem): string {
  if (item.chefHomeOnly) return "Chef's home only";
  return item.locationOptions.includes("chef_home")
    ? "At your home or the chef's home"
    : "At your home";
}

/** Public URL of a profile photo (bucket profile-photos is public). Null without config. */
export function profilePhotoUrl(
  path: string | null,
  supabaseUrl?: string,
): string | null {
  if (!path || !supabaseUrl) return null;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/profile-photos/${encoded}`;
}

/** Where a result's detail page lives (T-041). The id is a uuid from the API; still encoded. */
export const chefPath = (id: string) => `/chefs/${encodeURIComponent(id)}`;

// ---------------------------------------------------------------------------
// Map: pins at postal-area centres only
// ---------------------------------------------------------------------------
export interface MapPin {
  city: string;
  point: LatLng;
  items: PublicChefSearchItem[];
}

/**
 * One pin per service city, at the plain average of that city's postal-area centres (the same
 * centre a city search uses, A-18). The API does not give a chef's own area, and a pin must never
 * mark an address, so a pin means "chefs who work around here", not one kitchen.
 */
export function buildPins(
  items: readonly PublicChefSearchItem[],
  prefixes: readonly PostalPrefix[],
): MapPin[] {
  const byCity = new Map<string, PublicChefSearchItem[]>();
  for (const item of items) {
    if (!item.serviceCity) continue;
    const key = item.serviceCity.trim().toLowerCase();
    byCity.set(key, [...(byCity.get(key) ?? []), item]);
  }
  const pins: MapPin[] = [];
  for (const [key, group] of byCity) {
    const rows = prefixes.filter((p) => p.city.trim().toLowerCase() === key);
    if (rows.length === 0) continue;
    pins.push({
      city: rows[0].city,
      point: {
        lat: rows.reduce((s, r) => s + r.lat, 0) / rows.length,
        lng: rows.reduce((s, r) => s + r.lng, 0) / rows.length,
      },
      items: group,
    });
  }
  return pins.sort((a, b) => a.city.localeCompare(b.city));
}

/** The point the customer searched from: a postal area's centre or a city's average, else null. */
export function searchPoint(
  q: Pick<PublicChefSearchQuery, "postalCode" | "city">,
  prefixes: readonly PostalPrefix[],
): { label: string; point: LatLng } | null {
  if (q.postalCode) {
    const centres = new Map(
      prefixes.map((p) => [p.prefix, { lat: p.lat, lng: p.lng }]),
    );
    const point = centreForPostal(centres, q.postalCode);
    if (!point) return null;
    const prefix = q.postalCode
      .trim()
      .toUpperCase()
      .replace(/\s/g, "")
      .slice(0, 3);
    return { label: `Area ${prefix}`, point };
  }
  if (q.city) {
    const wanted = q.city.trim().toLowerCase();
    const rows = prefixes.filter((p) => p.city.trim().toLowerCase() === wanted);
    if (rows.length === 0) return null;
    return {
      label: rows[0].city,
      point: {
        lat: rows.reduce((s, r) => s + r.lat, 0) / rows.length,
        lng: rows.reduce((s, r) => s + r.lng, 0) / rows.length,
      },
    };
  }
  return null;
}

/** Sorted distinct city names for the city picker. */
export function cityNames(prefixes: readonly PostalPrefix[]): string[] {
  return [...new Set(prefixes.map((p) => p.city))].sort((a, b) =>
    a.localeCompare(b),
  );
}
