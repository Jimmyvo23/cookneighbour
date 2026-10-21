/**
 * Invisible characters and the fold for look-alike text (T-060, D-125). One module, used by the
 * browser and the server (through `text-safety.ts`, `address.ts` and `contactDetails.ts`).
 *
 * - Refused in public text: bidi controls (U+202A-202E, U+2066-2069), zero-width space U+200B,
 *   word joiner U+2060 and U+FEFF. They let text hide or reorder what a reader sees. Jimmy's
 *   2026-10-21 decision: the joiners U+200C and U+200D are ALLOWED in public text (joined emoji,
 *   Persian ZWNJ, Hindi conjuncts), but the fold below still strips them.
 * - Folded before the free-trial address key and the pre-acceptance contact filter: NFKC (full-width
 *   digits and letters become ASCII), accents removed, invisible characters removed. Other scripts
 *   (Vietnamese letters aside from tones, Chinese, Arabic, Hindi...) are kept as they are.
 */
const REFUSED_CHARS = /[\u202a-\u202e\u2066-\u2069\u200b\u2060\ufeff]/;
/** Everything the fold strips: the refused ones plus the joiners ZWNJ and ZWJ (U+200C, U+200D). */
const INVISIBLE_CHARS_G =
  /[\u202a-\u202e\u2066-\u2069\u200b-\u200d\u2060\ufeff]/g;
/** Combining marks of the "Combining Diacritical Marks" block: accents and Vietnamese tones. */
const ACCENTS = /[\u0300-\u036f]/g;
/** Dashes that look like a hyphen-minus: hyphen, non-breaking hyphen, figure, en, em dash, minus. */
const DASHES = /[\u2010-\u2015\u2212]/g;

export function hasInvisibleText(text: string): boolean {
  return REFUSED_CHARS.test(text);
}

/** Error text for a name or address line that has no visible character (T-093). */
export const NO_VISIBLE_TEXT = "Enter at least one visible character.";

/**
 * True when nothing visible is left after the fold and a trim: empty, spaces only, or only
 * joiners. Used for names and address lines (T-093); other free text is not checked with it.
 */
export function hasNoVisibleText(text: string): boolean {
  return foldText(text).trim() === "";
}

/**
 * NFKC, remove invisible characters, split accents off and drop them, join the rest again.
 * Vietnamese d with stroke (U+0111, U+0110) has no decomposition, so it is mapped to d / D here.
 * Combining marks outside the accent block (Hindi vowel signs, Arabic marks) are kept.
 */
export function foldText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(INVISIBLE_CHARS_G, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFD")
    .replace(ACCENTS, "")
    .normalize("NFC");
}

/** `foldText` plus look-alike dashes mapped to "-", for the phone and email filter. */
export function foldForContact(text: string): string {
  return foldText(text).replace(DASHES, "-");
}
