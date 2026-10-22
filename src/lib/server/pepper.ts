// Server-only access to HASH_PEPPER. Never log it, never put it in a response.
import "server-only";

import { MIN_PEPPER_LENGTH, checkPepper } from "@/lib/domain/pepper-rule";

export { MIN_PEPPER_LENGTH };

export function getHashPepper(): string {
  const v = process.env.HASH_PEPPER?.trim();
  if (!v) throw new Error("Missing environment variable HASH_PEPPER.");
  // Tests (vitest sets NODE_ENV=test) use short throwaway values; nothing else may.
  if (process.env.NODE_ENV === "test") return v;
  const check = checkPepper(v);
  if (!check.ok) throw new Error(check.message);
  return check.pepper;
}
