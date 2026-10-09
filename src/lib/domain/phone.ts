// Canadian phone numbers (PLAN.md A-3). Pure functions, no imports, so the seed script can share them.

/**
 * Normalizes common North American formats to E.164 ("+1XXXXXXXXXX"), or returns null when the
 * input is malformed. Accepts spaces, dashes, dots, parentheses, and an optional leading 1 or +1.
 * Area code and exchange must start with 2 to 9 and must not be an N11 code such as 911 or 411 (NANP rule). Letters and extensions are rejected.
 */
export function normalizePhone(input: string): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!/^\+?[0-9 ().-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  let national: string;
  if (digits.length === 10 && !trimmed.startsWith("+")) national = digits;
  else if (digits.length === 11 && digits.startsWith("1"))
    national = digits.slice(1);
  else return null;
  if (!/^[2-9][0-9]{2}[2-9][0-9]{6}$/.test(national)) return null;
  // N11 service codes (211, 311, 411, 911 and so on) are never an area code or an exchange.
  if (national.slice(1, 3) === "11" || national.slice(4, 6) === "11")
    return null;
  return `+1${national}`;
}

/** "+14165550101" becomes "+1******0101". Never returns the full number. */
export function maskPhone(e164: string): string {
  return `+1******${e164.slice(-4)}`;
}
