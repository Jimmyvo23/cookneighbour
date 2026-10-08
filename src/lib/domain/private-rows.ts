// Builds the profile_private column values for a phone or an address. Used by BOTH the API routes
// and scripts/seed.ts, so the stored hashes are identical no matter who wrote them.
import { addressKey, normalizePostalCode, postalPrefix } from "./address.ts";
import { addressHash, phoneHash } from "./hash.ts";
import { normalizePhone } from "./phone.ts";

export function phoneColumns(phone: string, pepper: string) {
  const e164 = normalizePhone(phone);
  if (!e164) throw new Error("invalid phone number");
  return { phone_e164: e164, phone_hash: phoneHash(e164, pepper) };
}

export function addressColumns(
  line: string,
  city: string,
  postalCode: string,
  pepper: string,
) {
  const pc = normalizePostalCode(postalCode);
  if (!pc) throw new Error("invalid postal code");
  addressKey(line, pc); // validates
  return {
    address_line: line.trim(),
    city: city.trim(),
    postal_code: pc,
    postal_prefix: postalPrefix(pc),
    address_hash: addressHash(line, pc, pepper),
  };
}
