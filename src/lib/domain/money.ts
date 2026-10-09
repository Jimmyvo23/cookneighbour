// Integer-cent helpers (A-12). Money is never a float: every amount is a safe integer number of
// cents, and every division rounds HALF UP (0.5 cent goes up) with integer arithmetic only.

export function assertCents(n: number, what: string): void {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(`${what} must be a non-negative whole number`);
}

/** round(n / d) with halves rounded up, for non-negative integers n and positive integer d. */
export function divRoundHalfUp(n: number, d: number): number {
  if (!Number.isSafeInteger(n) || n < 0 || !Number.isSafeInteger(d) || d <= 0)
    throw new RangeError(
      "divRoundHalfUp needs a non-negative n and a positive d",
    );
  const q = Math.floor(n / d);
  const r = n - q * d;
  return 2 * r >= d ? q + 1 : q;
}

/** cents * percent / 100, half up. `percent` may have up to 2 decimals (numeric(5,2) column). */
export function percentOf(cents: number, percent: number): number {
  assertCents(cents, "cents");
  const hundredths = Math.round(percent * 100);
  if (!(percent >= 0) || !Number.isSafeInteger(hundredths))
    throw new RangeError("percent must be a non-negative number");
  return divRoundHalfUp(cents * hundredths, 10000);
}
