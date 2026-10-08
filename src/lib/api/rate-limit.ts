// PLACEHOLDER rate limiter (contract section 9, open question Q-11).
// In-memory fixed window: counters live in one server process only, so on serverless hosting
// (Vercel) they reset on cold starts and are not shared between instances. Best effort for the
// prototype, NOT a real abuse defence. Keys must never contain a raw phone number or code.
import { createHash } from "node:crypto";
import { ApiFailure } from "./errors";

const buckets = new Map<string, { count: number; resetAt: number }>();

/** Throws 429 RATE_LIMITED when `key` has been used more than `limit` times in the window. */
export function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  now = Date.now(),
): void {
  if (buckets.size > 10_000)
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return;
  }
  if (b.count >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
    throw new ApiFailure(
      "RATE_LIMITED",
      "Too many attempts. Please try again later.",
      {
        retryAfterSeconds,
      },
    );
  }
  b.count += 1;
}

/** Hash an identifier (such as an email) so the map never holds it in clear text. */
export function limiterKey(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

export function resetRateLimits(): void {
  buckets.clear();
}
