// Server side of the public search routes (T-039, contract section 7).
//
// Authorization: these routes are open to everyone, so there is no caller check. They use the
// user-scoped (anon-capable) client only, never the service role. RLS limits chefs to approved
// rows, but a signed-in chef (own row), a booking counterparty and an admin also pass other
// policies, so every query here adds its own filter: status = 'approved' on chefs, is_active on
// dishes, available plus the date window on availability. Explicit column lists mean no private
// column is ever selected. Nothing is written.
import "server-only";
import { createClient as createAnonClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiFailure, validationFailed } from "@/lib/api/errors";
import type {
  LocationType,
  PostalPrefix,
  PostalPrefixListResponse,
  PublicChefDetail,
  PublicChefSearchResponse,
  PublicDish,
} from "@/lib/api/types";
import {
  AVAILABILITY_HORIZON_DAYS,
  addDays,
  torontoToday,
} from "@/lib/domain/dishes";
import {
  isListable,
  parseSearchQuery,
  publicLocationOptions,
  rankChefs,
  type ChefCandidate,
  type PrefixRow,
} from "@/lib/domain/search";
import { createClient } from "@/lib/supabase/server";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";

type Row = Record<string, unknown>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** PostgREST returns at most 1000 rows by default; say so instead of silently relying on it. */
const MAX_CHEFS = 1000;

const CHEF_COLUMNS =
  "profile_id, display_name, bio, photo_path, cuisines, languages, hourly_rate_cents, currency, rating_avg, review_count, service_postal_prefix, service_radius_km, location_options, chef_home_enabled";
const DISH_COLUMNS =
  "id, name, photo_path, description, cuisine, cook_minutes, ingredient_cost_cents, servings, allergens, shelf_life_days";

function fail(): ApiFailure {
  return new ApiFailure("INTERNAL", "Something went wrong. Please try again.");
}

function notFound(): ApiFailure {
  return new ApiFailure("NOT_FOUND", "Chef not found.");
}

const toPrefix = (r: Row): PrefixRow => ({
  prefix: r.prefix as string,
  city: r.city as string,
  lat: Number(r.lat),
  lng: Number(r.lng),
});

async function loadPrefixes(db: SupabaseClient): Promise<PrefixRow[]> {
  const { data, error } = await db
    .from("postal_prefixes")
    .select("prefix, city, lat, lng")
    .order("prefix");
  if (error || !data) {
    console.error("api: search prefixes read failed");
    throw fail();
  }
  return (data as Row[]).map(toPrefix);
}

/** GET /api/reference/postal-prefixes. A cookie-free client: the data is the same for everyone. */
export async function listPostalPrefixes(): Promise<PostalPrefixListResponse> {
  const { url, publishableKey } = getPublicSupabaseEnv();
  const db = createAnonClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rows = await loadPrefixes(db);
  const items: PostalPrefix[] = rows;
  return { items };
}

const stringArray = (v: unknown): string[] =>
  Array.isArray(v) ? (v as string[]) : [];

/** GET /api/chefs. */
export async function searchChefs(
  params: URLSearchParams,
): Promise<PublicChefSearchResponse> {
  const db = await createClient();
  const today = torontoToday();
  const prefixes = await loadPrefixes(db);
  const parsed = parseSearchQuery(params, { today, prefixes });
  if (!parsed.value) throw validationFailed(parsed.errors);
  const query = parsed.value;

  // Active dishes are joined in (inner: a chef without one is dropped, A-20). With a date filter
  // the availability join is inner as well, so only chefs who ticked that day come back.
  const dateJoin = query.date ? ", availability!inner(day)" : "";
  let req = db
    .from("chefs")
    .select(`${CHEF_COLUMNS}, dishes!inner(allergens)${dateJoin}`)
    .eq("status", "approved")
    .eq("dishes.is_active", true);
  if (query.date) {
    req = req
      .eq("availability.day", query.date)
      .eq("availability.available", true);
  }
  const { data, error } = await req.order("profile_id").range(0, MAX_CHEFS - 1);
  if (error || !data) {
    console.error("api: search chefs read failed");
    throw fail();
  }

  const candidates: ChefCandidate[] = (data as unknown as Row[]).map((r) => ({
    id: r.profile_id as string,
    displayName: r.display_name as string,
    bio: (r.bio as string | null) ?? null,
    photoPath: (r.photo_path as string | null) ?? null,
    cuisines: stringArray(r.cuisines),
    languages: stringArray(r.languages),
    hourlyRateCents: (r.hourly_rate_cents as number | null) ?? null,
    currency: r.currency as string,
    ratingAvg: Number(r.rating_avg),
    reviewCount: r.review_count as number,
    servicePrefix: (r.service_postal_prefix as string | null) ?? null,
    serviceRadiusKm: r.service_radius_km as number,
    locationOptions: stringArray(r.location_options) as LocationType[],
    chefHomeEnabled: r.chef_home_enabled === true,
    activeDishes: ((r.dishes as Row[] | null) ?? []).map((d) => ({
      allergens: stringArray(d.allergens),
    })),
  }));
  return rankChefs(candidates, query, prefixes);
}

const mapDish = (r: Row): PublicDish => ({
  id: r.id as string,
  name: r.name as string,
  photoPath: (r.photo_path as string | null) ?? null,
  description: (r.description as string | null) ?? null,
  cuisine: r.cuisine as string,
  cookMinutes: r.cook_minutes as number,
  ingredientCostCents: r.ingredient_cost_cents as number,
  servings: r.servings as number,
  allergens: stringArray(r.allergens),
  shelfLifeDays: r.shelf_life_days as number,
});

/** GET /api/chefs/:id. One identical 404 for every reason the public must not see this chef. */
export async function getChefDetail(id: string): Promise<PublicChefDetail> {
  if (!UUID_RE.test(id)) throw notFound();
  const db = await createClient();

  const { data: chef, error } = await db
    .from("chefs")
    .select(CHEF_COLUMNS)
    .eq("profile_id", id)
    .eq("status", "approved")
    .maybeSingle();
  if (error) {
    console.error("api: chef detail read failed");
    throw fail();
  }
  if (!chef) throw notFound();
  const c = chef as Row;

  const today = torontoToday();
  const last = addDays(today, AVAILABILITY_HORIZON_DAYS);
  const [dishRes, dayRes, prefixRes] = await Promise.all([
    db
      .from("dishes")
      .select(DISH_COLUMNS)
      .eq("chef_id", id)
      .eq("is_active", true)
      .order("created_at")
      .order("id"),
    db
      .from("availability")
      .select("day")
      .eq("chef_id", id)
      .eq("available", true)
      .gte("day", today)
      .lte("day", last)
      .order("day"),
    c.service_postal_prefix
      ? db
          .from("postal_prefixes")
          .select("city")
          .eq("prefix", c.service_postal_prefix as string)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (dishRes.error || dayRes.error || prefixRes.error) {
    console.error("api: chef detail read failed");
    throw fail();
  }
  const dishes = ((dishRes.data as Row[] | null) ?? []).map(mapDish);

  if (
    !isListable({
      bio: (c.bio as string | null) ?? null,
      photoPath: (c.photo_path as string | null) ?? null,
      activeDishCount: dishes.length,
    })
  )
    throw notFound();

  return {
    id: c.profile_id as string,
    displayName: c.display_name as string,
    bio: c.bio as string,
    photoPath: c.photo_path as string,
    cuisines: stringArray(c.cuisines),
    languages: stringArray(c.languages),
    hourlyRateCents: (c.hourly_rate_cents as number | null) ?? null,
    currency: c.currency as string,
    ratingAvg: Number(c.rating_avg),
    reviewCount: c.review_count as number,
    serviceCity:
      ((prefixRes.data as Row | null)?.city as string | null) ?? null,
    serviceRadiusKm: c.service_radius_km as number,
    locationOptions: publicLocationOptions(
      stringArray(c.location_options) as LocationType[],
      c.chef_home_enabled === true,
    ),
    dishes,
    bookableDates: ((dayRes.data as Row[] | null) ?? []).map(
      (d) => d.day as string,
    ),
    today,
    lastBookableDay: last,
  };
}
