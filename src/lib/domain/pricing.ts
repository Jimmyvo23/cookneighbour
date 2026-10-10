// Booking estimate (CLAUDE.md 6.4 and 6.5). Pure and in integer cents (A-12).
//
// ROUNDING RULE: every amount is a whole number of cents. Each division rounds half up (0.5 cent
// goes up), done with integer arithmetic (money.ts), never with float money. Rounding happens once
// per visit day and the booking figures are the exact sum of the day figures, so the lines on the
// estimate always add up to the total.
//
// ASSUMPTIONS (A-13 travel fee, A-14 platform fee, with the fee placeholders A-8 / Q-5; pending Jimmy):
//   - labour per day = cook minutes x hourly rate / 60;
//   - A-13: the travel fee is one-way straight-line distance (A-1 prefix centres) x rate, charged for each visit day (the chef travels
//     every day) and only for customer's-home bookings;
//   - A-14: the platform fee is a percentage of the labour the customer is charged for, is SHOWN only
//     (not collected, MOCK) and is NOT added to the total;
//   - the free trial waives labour only (and so the fee on it); ingredients and travel are paid.
import {
  DEFAULT_CURRENCY,
  PLATFORM_FEE_PERCENT,
  TRAVEL_RATE_CENTS_PER_KM,
  VISIT_SOFT_LIMIT_MINUTES,
} from "./config.ts";
import { assertCents, divRoundHalfUp, percentOf } from "./money.ts";
import { checkVisitLimits, type VisitLimitWarning } from "./visitLimit.ts";

export interface EstimateDish {
  cookMinutes: number;
  ingredientCostCents: number;
  quantity: number;
}

export interface EstimateInput {
  hourlyRateCents: number;
  locationType: "customer_home" | "chef_home";
  isFreeTrial: boolean;
  /** Days in order; each has the dishes picked for that visit. */
  days: { dishes: EstimateDish[] }[];
  /** Straight-line chef to customer distance in whole metres; required for customer_home. */
  distanceMetres?: number | null;
  platformFeePercent?: number;
  travelRateCentsPerKm?: number;
  softLimitMinutes?: number;
}

export interface DayEstimate {
  cookMinutes: number;
  labourCents: number;
  ingredientsCents: number;
  travelCents: number;
  platformFeeCents: number;
}

export interface Estimate extends DayEstimate {
  days: DayEstimate[];
  labourBeforeWaiverCents: number;
  freeTrialWaivedCents: number;
  totalCents: number;
  platformFeePercent: number;
  /** Always false: the platform fee is shown, never collected (MOCK, test mode). */
  platformFeeCollected: false;
  travelRateCentsPerKm: number;
  currency: string;
  exceedsSoftLimit: boolean;
  warnings: VisitLimitWarning[];
}

const positiveInt = (n: number, what: string) => {
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new RangeError(`${what} must be a positive whole number`);
};

export function estimateBooking(input: EstimateInput): Estimate {
  const rate = input.hourlyRateCents;
  positiveInt(rate, "hourlyRateCents");
  if (input.days.length < 1) throw new RangeError("at least one day");
  const feePercent = input.platformFeePercent ?? PLATFORM_FEE_PERCENT;
  const perKm = input.travelRateCentsPerKm ?? TRAVEL_RATE_CENTS_PER_KM;
  assertCents(perKm, "travelRateCentsPerKm");

  let travelPerDay = 0;
  if (input.locationType === "customer_home") {
    const m = input.distanceMetres;
    if (m == null || !Number.isSafeInteger(m) || m < 0)
      throw new RangeError("distanceMetres is required for customer_home");
    travelPerDay = divRoundHalfUp(m * perKm, 1000);
  }

  let waived = 0;
  const days: DayEstimate[] = input.days.map((day) => {
    let cookMinutes = 0;
    let ingredientsCents = 0;
    for (const d of day.dishes) {
      positiveInt(d.cookMinutes, "cookMinutes");
      positiveInt(d.quantity, "quantity");
      assertCents(d.ingredientCostCents, "ingredientCostCents");
      cookMinutes += d.cookMinutes * d.quantity;
      ingredientsCents += d.ingredientCostCents * d.quantity;
    }
    const fullLabour = divRoundHalfUp(cookMinutes * rate, 60);
    const labourCents = input.isFreeTrial ? 0 : fullLabour;
    waived += fullLabour - labourCents;
    return {
      cookMinutes,
      labourCents,
      ingredientsCents,
      travelCents: travelPerDay,
      platformFeeCents: percentOf(labourCents, feePercent),
    };
  });

  const sum = (k: keyof DayEstimate) => days.reduce((s, d) => s + d[k], 0);
  const labourCents = sum("labourCents");
  const ingredientsCents = sum("ingredientsCents");
  const travelCents = sum("travelCents");
  const warnings = checkVisitLimits(
    days.map((d) => d.cookMinutes),
    input.softLimitMinutes ?? VISIT_SOFT_LIMIT_MINUTES,
  );
  return {
    days,
    cookMinutes: sum("cookMinutes"),
    labourCents,
    ingredientsCents,
    travelCents,
    platformFeeCents: sum("platformFeeCents"),
    labourBeforeWaiverCents: labourCents + waived,
    freeTrialWaivedCents: waived,
    totalCents: labourCents + ingredientsCents + travelCents,
    platformFeePercent: feePercent,
    platformFeeCollected: false,
    travelRateCentsPerKm: perKm,
    currency: DEFAULT_CURRENCY,
    exceedsSoftLimit: warnings.length > 0,
    warnings,
  };
}
