// Address and postal-code normalization (PLAN.md A-1, A-2). Pure functions, no imports.

const ABBREVIATIONS: Record<string, string> = {
  street: "st",
  avenue: "ave",
  road: "rd",
  drive: "dr",
  boulevard: "blvd",
  court: "ct",
  crescent: "cres",
  lane: "ln",
  place: "pl",
  circle: "cir",
  terrace: "terr",
  trail: "trl",
  highway: "hwy",
  parkway: "pkwy",
  square: "sq",
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  // unit markers all become "unit"
  apt: "unit",
  apartment: "unit",
  suite: "unit",
  ste: "unit",
};

/**
 * A-2: lowercase, trim, strip punctuation, collapse spaces, map standard street words to their
 * abbreviations. Unit numbers are kept ("#5" and "unit 5" both keep the number as a token).
 */
export function normalizeAddressLine(line: string): string {
  const cleaned = line
    .toLowerCase()
    .replace(/#/g, " unit ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned
    .split(" ")
    .map((w) => ABBREVIATIONS[w] ?? w)
    .filter((w, i, all) => !(w === "unit" && all[i - 1] === "unit"))
    .join(" ");
}

/**
 * Canada Post letter rules: D, F, I, O, Q and U are never used, and W and Z are never the first
 * letter (they may appear in the other two letter positions).
 */
const POSTAL_RE =
  /^[ABCEGHJKLMNPRSTVXY][0-9][ABCEGHJKLMNPRSTVWXYZ][0-9][ABCEGHJKLMNPRSTVWXYZ][0-9]$/;

/** Uppercase, no spaces or dashes. Returns null unless it is a valid Canadian postal code A1A1A1. */
export function normalizePostalCode(input: string): string | null {
  const p = input.toUpperCase().replace(/[\s-]/g, "");
  return POSTAL_RE.test(p) ? p : null;
}

export function postalPrefix(postalCode: string): string {
  return postalCode.slice(0, 3);
}

/** The exact string that gets hashed for the free-trial address check. */
export function addressKey(line: string, postalCode: string): string {
  const pc = normalizePostalCode(postalCode);
  if (!pc) throw new Error("invalid postal code");
  return `${normalizeAddressLine(line)}|${pc}`;
}
