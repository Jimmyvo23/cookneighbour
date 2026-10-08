// Small pure helpers for scripts/seed.ts (unit-tested in src/lib/seed-data.test.ts).
import { createHash, createHmac } from "node:crypto";

export interface PostalPrefixRow {
  prefix: string;
  city: string;
  lat: number;
  lng: number;
}

/** Reads the ('L5B', 'City', lat, lng) tuples from supabase/seed.sql (single source of truth). */
export function parsePostalPrefixes(sql: string): PostalPrefixRow[] {
  const re = /^\s*\('([A-Z]\d[A-Z])', '([^']+)', (-?[\d.]+), (-?[\d.]+)\)/gm;
  return [...sql.matchAll(re)].map((m) => ({
    prefix: m[1],
    city: m[2],
    lat: Number(m[3]),
    lng: Number(m[4]),
  }));
}

/** Deterministic UUID (name-based, SHA-1, version 5 layout) so re-running the seed upserts. */
export function stableUuid(name: string): string {
  const h = createHash("sha1").update(`cookneighbour-seed:${name}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

// Abuse-check hashes (CLAUDE.md 6.6, A-2/A-3): peppered SHA-256. HMAC-SHA256 keyed with the
// pepper. The booking code (WO-4) must use the identical scheme; keep them in step.
export function phoneHash(e164: string, pepper: string): string {
  return createHmac("sha256", pepper).update(`phone:${e164}`).digest("hex");
}

export function normalizeAddress(line: string, postalCode: string): string {
  const l = line.toLowerCase().replace(/\s+/g, " ").trim();
  const p = postalCode.toUpperCase().replace(/\s+/g, "");
  return `${l}|${p}`;
}

export function addressHash(
  line: string,
  postalCode: string,
  pepper: string,
): string {
  return createHmac("sha256", pepper)
    .update(`address:${normalizeAddress(line, postalCode)}`)
    .digest("hex");
}
