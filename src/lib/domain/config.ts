// Configurable booking constants (T-037). Pure data, no imports.
//
// Every value marked ASSUMPTION is a placeholder from PLAN.md that Jimmy has NOT decided:
//   - fees and radius:   A-8, open question Q-5 (commission percentage and travel-fee rate)
//   - cancellation:      A-6, open question Q-8 (timing rules)
//   - eat-by default:    A-7, Q-10 (real window must be confirmed with Ontario public-health guidance)
// Change a value here only; the rules read these names and tests import them, so nothing else
// hard-codes a number. The values copy the database defaults (bookings.platform_fee_percent = 10,
// bookings.travel_rate_cents_per_km = 60, chefs.service_radius_km = 15).

/** CLAUDE.md 6.4: a booking is 1 to 3 days (one visit each). Requirement, not an assumption. */
export const MIN_BOOKING_DAYS = 1;
export const MAX_BOOKING_DAYS = 3;

/** CLAUDE.md 6.5: soft safety limit per visit, 6 hours. Configurable constant (requirement). */
export const VISIT_SOFT_LIMIT_MINUTES = 6 * 60;

/** ASSUMPTION A-8 / Q-5: platform fee percentage, shown in the estimate, NOT collected (MOCK). */
export const PLATFORM_FEE_PERCENT = 10;

/** ASSUMPTION A-8 / Q-5: travel fee, cents per km, one way, charged for each visit day. */
export const TRAVEL_RATE_CENTS_PER_KM = 60;

/** ASSUMPTION A-8 / Q-5: default chef travel radius in km (the database default as well). */
export const DEFAULT_SERVICE_RADIUS_KM = 15;

/** ASSUMPTION A-6 / Q-8: free cancellation until this many hours before the first day starts. */
export const FREE_CANCELLATION_HOURS = 48;

/** ASSUMPTION: at most this many portions of one dish per visit (the model has `quantity`). */
export const MAX_DISH_QUANTITY = 10;

/**
 * ASSUMPTION (no source in PLAN.md; to confirm with Jimmy): a receipt is flagged when it differs
 * from the estimated ingredients by more than the larger of RECEIPT_TOLERANCE_PERCENT of the
 * estimate and RECEIPT_TOLERANCE_MIN_CENTS. The floor keeps a small estimate from flagging a
 * normal few-dollar difference.
 */
export const RECEIPT_TOLERANCE_PERCENT = 10;
export const RECEIPT_TOLERANCE_MIN_CENTS = 500;

/** Currency and country stored with every estimate (CLAUDE.md 3). */
export const DEFAULT_CURRENCY = "CAD";
export const DEFAULT_COUNTRY = "CA";
