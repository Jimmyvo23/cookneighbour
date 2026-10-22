// Server-only access to HASH_PEPPER. Never log it, never put it in a response.
import "server-only";

/** A shorter pepper makes the phone-number hashes easy to brute-force (T-102, LOW-7). */
export const MIN_PEPPER_LENGTH = 32;

export function getHashPepper(): string {
  const v = process.env.HASH_PEPPER?.trim();
  if (!v) throw new Error("Missing environment variable HASH_PEPPER.");
  // Tests (vitest sets NODE_ENV=test) use short throwaway values; nothing else may.
  if (process.env.NODE_ENV !== "test" && v.length < MIN_PEPPER_LENGTH)
    throw new Error(
      `HASH_PEPPER must be at least ${MIN_PEPPER_LENGTH} characters.`,
    );
  return v;
}
