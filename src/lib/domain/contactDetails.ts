// Best-effort filter for text that one party writes and the other party may read BEFORE the
// booking is accepted (CLAUDE.md 6.8: no phone numbers or addresses until accepted). Used for the
// chef's decline reason (D-34); reusable for T-063 and WO-5 messaging.
//
// It catches a North American phone shape (T-088: 10 digits, or 11 starting with 1, with spaces,
// dots, dashes, brackets or a leading +), an email address and a URL. Shorter runs (order numbers,
// dates, 7-digit local numbers), 12 or more digits in a row and prices pass. It does NOT detect street addresses and
// it can be fooled (spelled-out digits, "at"/"dot" tricks, spaced letters). Known limit for the
// README; the real protection is that private data lives in tables the other party cannot read.
import { foldForContact } from "./text-fold.ts";

export type ContactKind = "phone" | "email" | "url";

// Calendar dates such as 2026-10-20 are not phone numbers.
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const URL_LIKE =
  /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|ca|org|net|io|me|co|app|info|ly|gl)\b(?:\/\S*)?/i;
const PHONE_RUN = /\+?[\d(][\d\s\-.()]*\d/g;
// 3-3-4 digits (optional leading 1), not glued to other digits, so it is also found after other
// numbers in the same run ("ref 12345 416 555 0199").
const PHONE_SHAPE =
  /(?<!\d)(?:\+?1[\s.\-]*)?\(?\d{3}\)?[\s.\-]*\d{3}[\s.\-]*\d{4}(?!\d)/;

function isNorthAmericanDigits(d: string): boolean {
  return d.length === 10 || (d.length === 11 && d.startsWith("1"));
}

export function findContactDetails(input: string): ContactKind | null {
  // T-060 (D-125): fold full-width digits, accents, invisible characters and look-alike dashes first.
  const text = foldForContact(input);
  if (EMAIL.test(text)) return "email";
  if (URL_LIKE.test(text)) return "url";
  const withoutDates = text.replace(ISO_DATE, " ");
  for (const run of withoutDates.match(PHONE_RUN) ?? []) {
    if (isNorthAmericanDigits(run.replace(/\D/g, ""))) return "phone";
    if (PHONE_SHAPE.test(run)) return "phone";
  }
  return null;
}
