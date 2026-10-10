// Distance between postal-prefix centres (A-1). Straight-line (haversine), no geocoding service.
import { normalizePostalCode, postalPrefix } from "./address.ts";

export interface LatLng {
  lat: number;
  lng: number;
}

/** prefix (e.g. "L5B") to its centre. Loaded from the `postal_prefixes` table by the caller. */
export type PrefixCentres = ReadonlyMap<string, LatLng>;

const EARTH_RADIUS_KM = 6371.0088;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Centre of a full or partial postal code, or null when malformed or not in the GTA table. */
export function centreForPostal(
  centres: PrefixCentres,
  postalOrPrefix: string,
): LatLng | null {
  const full = normalizePostalCode(postalOrPrefix);
  const prefix = full
    ? postalPrefix(full)
    : postalOrPrefix.trim().toUpperCase().replace(/\s/g, "");
  if (!/^[A-Z][0-9][A-Z]$/.test(prefix)) return null;
  return centres.get(prefix) ?? null;
}

/** Whole metres, so money maths below stays in integers. */
export function distanceMetres(a: LatLng, b: LatLng): number {
  return Math.round(haversineKm(a, b) * 1000);
}
