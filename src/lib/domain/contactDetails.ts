// Best-effort filter for text that one party writes and the other party may read BEFORE the
// booking is accepted (CLAUDE.md 6.8: no phone numbers or addresses until accepted). Used for the
// chef's decline reason (D-34); reusable for T-063 and WO-5 messaging.
//
// It catches a phone-number-like run of digits (7 or more digits, with spaces, dashes, dots,
// brackets or a leading +), an email address and a URL. It does NOT detect street addresses and
// it can be fooled (spelled-out digits, "at"/"dot" tricks, spaced letters). Known limit for the
// README; the real protection is that private data lives in tables the other party cannot read.
export type ContactKind = "phone" | "email" | "url";

// Calendar dates such as 2026-10-20 are not phone numbers.
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const URL_LIKE =
  /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|ca|org|net|io|me|co|app|info|ly|gl)\b(?:\/\S*)?/i;
const PHONE_RUN = /\+?[\d(][\d\s\-.()]{5,}\d/g;

export function findContactDetails(text: string): ContactKind | null {
  if (EMAIL.test(text)) return "email";
  if (URL_LIKE.test(text)) return "url";
  const withoutDates = text.replace(ISO_DATE, " ");
  for (const run of withoutDates.match(PHONE_RUN) ?? [])
    if (run.replace(/\D/g, "").length >= 7) return "phone";
  return null;
}
