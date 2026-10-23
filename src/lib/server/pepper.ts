// Server-only access to HASH_PEPPER. Never log it, never put it in a response.
import "server-only";

import {
  MIN_PEPPER_LENGTH,
  PUBLIC_PEPPER_MESSAGE,
  checkPepper,
} from "@/lib/domain/pepper-rule";

export { MIN_PEPPER_LENGTH };

export function getHashPepper(): string {
  const v = process.env.HASH_PEPPER?.trim();
  if (!v) throw new Error("Missing environment variable HASH_PEPPER.");
  // On Vercel the public local test pepper is refused, even under NODE_ENV=test (T-112).
  const onVercel = Boolean(process.env.VERCEL);
  if (onVercel) {
    const hosted = checkPepper(v, { forbidPublicTestPepper: true });
    if (!hosted.ok && hosted.message === PUBLIC_PEPPER_MESSAGE)
      throw new Error(hosted.message);
  }
  // Tests (vitest sets NODE_ENV=test) use short throwaway values; nothing else may.
  if (process.env.NODE_ENV === "test") return v;
  const check = checkPepper(v);
  if (!check.ok) throw new Error(check.message);
  return check.pepper;
}
