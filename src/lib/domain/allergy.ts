// Allergy conflicts (CLAUDE.md 10): the customer's intake allergies against each chosen dish's
// allergens. A conflict is a WARNING that the customer must acknowledge (intake_forms.
// allergy_conflict_acknowledged); it never blocks by itself. Dish allergens are stored lower-case
// and trimmed (dishes.ts), the intake is free text, so both sides are normalized here.
//
// Matching is deliberately on the cautious side, because a missed allergy is worse than an extra
// warning: an intake entry matches an allergen when the allergen's words appear in it in order
// (so "severe peanut allergy" matches "peanuts"), ignoring a trailing "s" on each word. It does
// NOT understand synonyms or cross-reactivity (for example "shellfish" vs "shrimp"): known gap,
// the chef reads the intake form too (Q-3 liability is an open legal risk).

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

/** Splits free text or a list into separate entries (comma, semicolon, slash, line break). */
export function splitAllergies(intake: string | readonly string[]): string[] {
  const parts = typeof intake === "string" ? [intake] : [...intake];
  return parts
    .flatMap((p) => p.split(/[,;/\n\r]+/))
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
}

function containsSequence(hay: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++)
    if (needle.every((w, j) => hay[i + j] === w)) return true;
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
      if (entries.some((e) => containsSequence(e, aw))) hits.add(a);
    }
    if (hits.size > 0)
      out.push({ dishId: dish.id, dishName: dish.name, allergens: [...hits] });
  }
  return out;
}
