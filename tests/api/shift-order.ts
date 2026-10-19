// Pure helper for `shiftDays` (T-086). No database or env needed, so it is easy to test.

/**
 * Puts booking days in the order in which they can be moved `n` days earlier (n > 0) or later
 * (n < 0) one row at a time without two days ever sharing a date. The partial unique index
 * `booking_days_one_per_chef_date` is checked after every single update, so the day that moves
 * toward the others must go last: ascending `visit_date` when moving earlier, descending when
 * moving later. With days [0, +1] and n = 1, moving day 2 first would land it on day 1's date.
 */
export function orderForShift<T extends { visit_date: string }>(
  days: readonly T[],
  n: number,
): T[] {
  const asc = [...days].sort((a, b) =>
    a.visit_date.localeCompare(b.visit_date),
  );
  return n > 0 ? asc : asc.reverse();
}
