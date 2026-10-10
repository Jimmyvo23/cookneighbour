// Allergy conflicts (CLAUDE.md 10): the customer's intake allergies against each chosen dish's
// allergens. A conflict is a WARNING that the customer must acknowledge (intake_forms.
// allergy_conflict_acknowledged); it never blocks by itself. Dish allergens are stored lower-case
// and trimmed (dishes.ts), the intake is free text, so both sides are normalized here.
//
// Matching is deliberately on the cautious side, because a missed allergy is worse than an extra
// warning. A dish allergen is a conflict when, in any intake entry, either:
//   - all of the allergen's words appear in order ("severe peanut allergy" matches "peanuts"), or
//   - ANY non-filler word of the entry equals ANY word of the allergen ("nuts", "nut allergy" or
//     "my son: nuts" match "tree nuts").
// Words are compared lower-case, without punctuation, ignoring a trailing "s". A false conflict is
// acceptable; a missed one is not. Synonyms and spellings of the picker allergens are matched
// through the fixed SYNONYM_GROUPS below (D-24, for example "shellfish" vs "shrimp", "dairy" vs
// "milk", "gluten" vs "wheat"). Anything outside that list is not understood: the chef reads the
// intake form too (Q-3 liability is an open legal risk).

export interface DishAllergens {
  id: string;
  name: string;
  allergens: readonly string[];
}

export interface AllergyConflict {
  dishId: string;
  dishName: string;
  /** The dish's own (normalized) allergens that matched the intake. */
  allergens: string[];
}

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));

/**
 * D-24: words that count as the same allergen (after lower-casing and the trailing-"s" rule in
 * words()). A word may be in more than one group ("shellfish" covers crustaceans and molluscs).
 * Deliberately generous: a false warning is acceptable, a missed allergy is not. Fixed list, not
 * a medical reference (cross-reactivity such as peanut vs tree nut is warned on purpose).
 */
export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["gluten", "wheat"],
  ["dairy", "lactose", "milk"],
  ["shellfish", "shrimp", "prawn", "crab", "lobster", "crustacean"],
  [
    "shellfish",
    "mollusk",
    "mollusc",
    "clam",
    "squid",
    "oyster",
    "mussel",
    "scallop",
  ],
  [
    "nut",
    "peanut",
    "groundnut",
    "almond",
    "cashew",
    "walnut",
    "pecan",
    "pistachio",
    "hazelnut",
  ],
  ["soy", "soya"],
  ["sulfite", "sulphite"],
];

const GROUPS_OF = new Map<string, number[]>();
SYNONYM_GROUPS.forEach((g, i) =>
  g.forEach((w) => GROUPS_OF.set(w, [...(GROUPS_OF.get(w) ?? []), i])),
);

/** Same word, or two words of one synonym group. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const ga = GROUPS_OF.get(a);
  const gb = GROUPS_OF.get(b);
  return !!ga && !!gb && ga.some((g) => gb.includes(g));
}

/**
 * Words that carry no allergen ("nut allergy", "allergic to nuts", "severe", "gluten-free"). They
 * are dropped before the customer's words are looked for inside a longer dish allergen.
 */
export const FILLER = new Set([
  "allergy",
  "allergic",
  "allergie",
  "allergen",
  "intolerance",
  "intolerant",
  "sensitivity",
  "to",
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "severe",
  "mild",
  "i",
  "am",
  "have",
  "has",
  "my",
  "is",
  "no",
  "not",
  "free",
  "any",
  "with",
  "also",
  "very",
  "bad",
]);

/**
 * Splits free text or a list into separate entries: comma, semicolon, slash, ampersand, the word
 * "and", and line breaks.
 */
export function splitAllergies(intake: string | readonly string[]): string[] {
  const parts = typeof intake === "string" ? [intake] : [...intake];
  return parts
    .flatMap((p) => p.split(/[,;/\n\r&]+|\band\b/i))
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
}

function containsSequence(hay: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++)
    if (needle.every((w, j) => sameWord(hay[i + j], w))) return true;
  return false;
}

export function findAllergyConflicts(
  intake: string | readonly string[],
  dishes: readonly DishAllergens[],
): AllergyConflict[] {
  const entries = splitAllergies(intake).map(words);
  if (entries.length === 0) return [];
  const out: AllergyConflict[] = [];
  for (const dish of dishes) {
    const hits = new Set<string>();
    for (const raw of dish.allergens) {
      const a = raw.trim().toLowerCase();
      const aw = words(a);
      // Both ways, cautiously: the allergen's words are in the intake ("severe peanut allergy"
      // vs "peanuts"), or any content word of the customer's is a word of the allergen ("nuts" or
      // "really bad nut allergy" vs "tree nuts"). A false conflict is better than a missed one.
      if (
        entries.some(
          (e) =>
            containsSequence(e, aw) ||
            e.some((w) => !FILLER.has(w) && aw.some((x) => sameWord(w, x))),
        )
      )
        hits.add(a);
    }
    if (hits.size > 0)
      out.push({ dishId: dish.id, dishName: dish.name, allergens: [...hits] });
  }
  return out;
}
