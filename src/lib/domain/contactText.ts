// T-101 (D-147, D-148): contact details in text people write about themselves. The same
// `findContactDetails` filter as chat and reviews, applied to display names, chef bios, dish
// names and descriptions, and the customer's allergy and dietary notes. Shared by the domain
// parsers (so the browser and the MOCK adapter check too) and by the server routes.
import { findContactDetails } from "./contactDetails.ts";

export const CONTACT_FIELD_MESSAGE =
  "Remove phone numbers, email addresses and links.";

export const CONTACT_FAILURE_MESSAGE =
  "Do not put phone numbers, email addresses or links in this text. Contact details are shared after a booking is accepted.";

/** The field message when `text` holds a phone number, email address or link, else null. */
export function contactProblem(text: string): string | null {
  return findContactDetails(text) ? CONTACT_FIELD_MESSAGE : null;
}

/**
 * 422 code for a set of field errors: CONTACT_DETAILS_NOT_ALLOWED when every error is the contact
 * message (the only problem is contact details), else VALIDATION_FAILED.
 */
export function failureForFields(errors: Record<string, string>): {
  code: "VALIDATION_FAILED" | "CONTACT_DETAILS_NOT_ALLOWED";
  message: string;
} {
  const values = Object.values(errors);
  if (values.length > 0 && values.every((m) => m === CONTACT_FIELD_MESSAGE))
    return {
      code: "CONTACT_DETAILS_NOT_ALLOWED",
      message: CONTACT_FAILURE_MESSAGE,
    };
  return {
    code: "VALIDATION_FAILED",
    message: "Check the highlighted fields.",
  };
}
