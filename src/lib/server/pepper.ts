// Server-only access to HASH_PEPPER. Never log it, never put it in a response.
import "server-only";

export function getHashPepper(): string {
  const v = process.env.HASH_PEPPER?.trim();
  if (!v) throw new Error("Missing environment variable HASH_PEPPER.");
  return v;
}
