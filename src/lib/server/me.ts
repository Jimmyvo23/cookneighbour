// Loads and maps the caller's own profile data. Explicit column lists: hashes and the full phone
// number are never selected into a response.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ChefOwnSummary,
  MePrivate,
  MeProfile,
  MeResponse,
} from "@/lib/api/types";
import { maskPhone } from "@/lib/domain/phone";

type Row = Record<string, unknown>;

export function mapProfile(r: Row): MeProfile {
  return {
    id: r.id as string,
    role: r.role as MeProfile["role"],
    displayName: r.display_name as string,
    country: r.country as string,
    currency: r.currency as string,
    language: r.language as string,
  };
}

export const PROFILE_COLUMNS =
  "id, role, display_name, country, currency, language";

export async function loadProfile(
  db: SupabaseClient,
  id: string,
): Promise<MeProfile> {
  const { data, error } = await db
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", id)
    .single();
  if (error || !data) throw new Error(`profile load failed: ${error?.message}`);
  return mapProfile(data);
}

export function mapChef(r: Row): ChefOwnSummary {
  return {
    status: r.status as ChefOwnSummary["status"],
    displayName: r.display_name as string,
    bio: (r.bio as string | null) ?? null,
    photoPath: (r.photo_path as string | null) ?? null,
    cuisines: r.cuisines as string[],
    languages: r.languages as string[],
    hourlyRateCents: (r.hourly_rate_cents as number | null) ?? null,
    servicePostalPrefix: (r.service_postal_prefix as string | null) ?? null,
    serviceRadiusKm: r.service_radius_km as number,
    locationOptions: r.location_options as ChefOwnSummary["locationOptions"],
    chefHomeEnabled: r.chef_home_enabled as boolean,
    country: r.country as string,
    currency: r.currency as string,
    language: r.language as string,
  };
}

export const CHEF_COLUMNS =
  "status, display_name, bio, photo_path, cuisines, languages, hourly_rate_cents, service_postal_prefix, service_radius_km, location_options, chef_home_enabled, country, currency, language";

export async function loadMe(
  db: SupabaseClient,
  id: string,
): Promise<MeResponse> {
  const profile = await loadProfile(db, id);
  const { data: pr, error } = await db
    .from("profile_private")
    .select(
      "phone_e164, phone_verified, address_line, city, postal_code, postal_prefix",
    )
    .eq("profile_id", id)
    .maybeSingle();
  if (error) throw new Error(`private load failed: ${error.message}`);
  const priv: MePrivate = {
    phoneMasked: pr?.phone_e164 ? maskPhone(pr.phone_e164 as string) : null,
    phoneVerified: Boolean(pr?.phone_verified),
    address: pr?.address_line
      ? {
          line: pr.address_line as string,
          city: pr.city as string,
          postalCode: pr.postal_code as string,
          postalPrefix: pr.postal_prefix as string,
        }
      : null,
  };
  let chef: ChefOwnSummary | null = null;
  if (profile.role === "chef") {
    const { data: c, error: ce } = await db
      .from("chefs")
      .select(CHEF_COLUMNS)
      .eq("profile_id", id)
      .maybeSingle();
    if (ce) throw new Error(`chef load failed: ${ce.message}`);
    chef = c ? mapChef(c) : null;
  }
  return { profile, private: priv, chef };
}
