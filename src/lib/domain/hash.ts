// Abuse-check hashes (CLAUDE.md 6.6, PLAN.md A-2/A-3): HMAC-SHA256 keyed with the server-only
// HASH_PEPPER. The pepper is always passed in; this file never reads the environment. The app
// (src/lib/server/hashes.ts) and the seed script (scripts/seed.ts) both use these functions, so
// demo hashes match what the app computes.
import { createHmac } from "node:crypto";
import { addressKey } from "./address.ts";
import { normalizePhone } from "./phone.ts";

function hmac(pepper: string, value: string): string {
  if (!pepper) throw new Error("pepper is required");
  return createHmac("sha256", pepper).update(value).digest("hex");
}

/** Normalizes to E.164 first, so "(416) 555-0101" and "+14165550101" hash the same. */
export function phoneHash(phone: string, pepper: string): string {
  const e164 = normalizePhone(phone);
  if (!e164) throw new Error("invalid phone number");
  return hmac(pepper, `phone:${e164}`);
}

export function addressHash(
  line: string,
  postalCode: string,
  pepper: string,
): string {
  return hmac(pepper, `address:${addressKey(line, postalCode)}`);
}
