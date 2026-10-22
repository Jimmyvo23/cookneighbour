// Small pure helpers for scripts/seed.ts (unit-tested in src/lib/seed-data.test.ts).
// Phone/address normalization and hashing live in src/lib/domain/ and are shared with the app.
import { createHash } from "node:crypto";
import { DEMO_CHEF_PASSWORD, DEMO_CUSTOMER_PASSWORD } from "./seed-data.ts";

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

export const MIN_HOSTED_DEMO_PASSWORD_LENGTH = 12;

/**
 * Demo account passwords for a seed target (T-099 / T-053 MED-2). The built-in constants are public
 * (they live in this repo), so they are used for --local only. --hosted must get its own passwords
 * from the environment. Error messages name the variable and never contain a password value.
 */
export function resolveDemoPasswords(
  target: "local" | "hosted",
  env: Record<string, string | undefined>,
): { chef: string; customer: string } {
  if (target === "local")
    return { chef: DEMO_CHEF_PASSWORD, customer: DEMO_CUSTOMER_PASSWORD };
  const read = (name: string, publicDefault: string): string => {
    const value = env[name] ?? "";
    if (!value)
      throw new Error(
        `--hosted needs ${name} in the environment (the built-in demo passwords are public and are never used on hosted).`,
      );
    if (value.length < MIN_HOSTED_DEMO_PASSWORD_LENGTH)
      throw new Error(
        `${name} must be at least ${MIN_HOSTED_DEMO_PASSWORD_LENGTH} characters.`,
      );
    if (value === publicDefault)
      throw new Error(
        `${name} must not be the built-in demo password from the repo. Choose your own.`,
      );
    return value;
  };
  return {
    chef: read("SEED_DEMO_CHEF_PASSWORD", DEMO_CHEF_PASSWORD),
    customer: read("SEED_DEMO_CUSTOMER_PASSWORD", DEMO_CUSTOMER_PASSWORD),
  };
}
