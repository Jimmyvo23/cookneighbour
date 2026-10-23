// The HASH_PEPPER rule, shared by the app (src/lib/server/pepper.ts) and scripts/seed.ts.
// Pure, no "server-only" import, so the seed script can use it. Never log or return the value
// in a message.
import { LOCAL_TEST_PEPPER } from "./local-test-pepper.ts";

/** A shorter pepper makes the phone-number hashes easy to brute-force (T-102, LOW-7). */
export const MIN_PEPPER_LENGTH = 32;

export type PepperCheck =
  { ok: true; pepper: string } | { ok: false; message: string };

export const PUBLIC_PEPPER_MESSAGE =
  "HASH_PEPPER must not be the public local test pepper.";

/**
 * Trims (the app and the seed must hash with the same value) and checks the minimum length.
 * With `forbidPublicTestPepper` (hosted seed, app on Vercel) the public LOCAL_TEST_PEPPER is
 * refused too, because anyone can read it in the repo (T-112).
 */
export function checkPepper(
  raw: string | undefined,
  opts: { forbidPublicTestPepper?: boolean } = {},
): PepperCheck {
  const pepper = raw?.trim() ?? "";
  if (!pepper)
    return { ok: false, message: "Missing environment variable HASH_PEPPER." };
  if (pepper.length < MIN_PEPPER_LENGTH)
    return {
      ok: false,
      message: `HASH_PEPPER must be at least ${MIN_PEPPER_LENGTH} characters.`,
    };
  if (opts.forbidPublicTestPepper && pepper === LOCAL_TEST_PEPPER)
    return { ok: false, message: PUBLIC_PEPPER_MESSAGE };
  return { ok: true, pepper };
}
