// Free-trial rules (CLAUDE.md 6.6, PLAN R-4, A-16). Pure functions, no I/O.
//
// One free-labour booking per customer, ever. A claim row (free_trial_claims) holds the trial for
// one booking and carries the hashes of the customer's verified phone and home address. A claim
// blocks while it is `held` or `consumed`; a `released` claim blocks nothing (the booking never
// happened). The database enforces the same rule with three partial unique indexes; this file is
// the readable copy of the rule and the only state machine.
//
// What each booking outcome does to the claim is NOT written here: it comes from
// `freeTrialEffect` in cancellation.ts (A-16), the single source for hold / consume / release.
import { freeTrialEffect, type FreeTrialEvent } from "./cancellation.ts";

export type FreeTrialState = "held" | "consumed" | "released";
export type FreeTrialBlockReason = "customer" | "phone" | "address";

/** The fields of a claim that the eligibility rule needs. */
export interface ClaimSummary {
  customerId: string;
  phoneHash: string;
  addressHash: string;
  state: FreeTrialState;
}

export interface TrialApplicant {
  customerId: string;
  phoneHash: string;
  addressHash: string;
}

export type Eligibility =
  { eligible: true } | { eligible: false; reason: FreeTrialBlockReason };

/**
 * Eligible unless a non-released claim has the same customer, phone hash or address hash.
 * `reason` is for the admin block log only. It must never reach the customer (it would tell an
 * attacker which of their details another account already used).
 */
export function evaluateFreeTrial(
  applicant: TrialApplicant,
  claims: readonly ClaimSummary[],
): Eligibility {
  const live = claims.filter((c) => c.state !== "released");
  if (live.some((c) => c.customerId === applicant.customerId))
    return { eligible: false, reason: "customer" };
  if (live.some((c) => c.phoneHash === applicant.phoneHash))
    return { eligible: false, reason: "phone" };
  if (live.some((c) => c.addressHash === applicant.addressHash))
    return { eligible: false, reason: "address" };
  return { eligible: true };
}

export type Transition =
  | { kind: "noop"; state: FreeTrialState }
  | { kind: "change"; from: "held"; to: "consumed" | "released" }
  | { kind: "invalid"; state: FreeTrialState };

/**
 * What a booking event does to a claim in `state`. Only `held` can change. Repeating the outcome
 * a claim already has is a no-op (safe to retry); the opposite outcome, or a "still active" event
 * on a finished claim, is invalid (it means the booking and the claim disagree).
 */
export function transitionFreeTrial(
  state: FreeTrialState,
  event: FreeTrialEvent,
): Transition {
  const effect = freeTrialEffect(event);
  if (effect === "hold")
    return state === "held"
      ? { kind: "noop", state }
      : { kind: "invalid", state };
  const target = effect === "consume" ? "consumed" : "released";
  if (state === "held") return { kind: "change", from: "held", to: target };
  return state === target
    ? { kind: "noop", state }
    : { kind: "invalid", state };
}
