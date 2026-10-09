// Receipt check for grocery option B, "chef shops" (CLAUDE.md 6.4 and 10). The chef uploads a
// receipt with its amount; the customer reimburses at cost (no markup). When the amount is not
// close to the estimated ingredients the receipt is flagged and the customer must confirm it
// (receipts.mismatch_flag / customer_confirmed_at). Pure and in integer cents.
//
// ASSUMPTION (config.ts): flagged when the difference, in either direction, is MORE than the
// larger of RECEIPT_TOLERANCE_PERCENT of the estimate and RECEIPT_TOLERANCE_MIN_CENTS.
import {
  RECEIPT_TOLERANCE_MIN_CENTS,
  RECEIPT_TOLERANCE_PERCENT,
} from "./config.ts";
import { assertCents, percentOf } from "./money.ts";

export interface ReceiptCheck {
  mismatch: boolean;
  /** receipt minus estimate; positive means the chef spent more than estimated. */
  differenceCents: number;
  toleranceCents: number;
}

export function checkReceipt(
  estimatedIngredientsCents: number,
  receiptCents: number,
): ReceiptCheck {
  assertCents(estimatedIngredientsCents, "estimatedIngredientsCents");
  assertCents(receiptCents, "receiptCents");
  const toleranceCents = Math.max(
    percentOf(estimatedIngredientsCents, RECEIPT_TOLERANCE_PERCENT),
    RECEIPT_TOLERANCE_MIN_CENTS,
  );
  const differenceCents = receiptCents - estimatedIngredientsCents;
  return {
    mismatch: Math.abs(differenceCents) > toleranceCents,
    differenceCents,
    toleranceCents,
  };
}
