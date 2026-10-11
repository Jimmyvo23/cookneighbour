// Dietary filter for search (A-17, pending Jimmy). Chefs have no dietary data, so "dietary needs"
// means allergen exclusion: a chef matches when at least one ACTIVE dish contains none of the
// selected allergens. D-31 (T-042): the match uses the same words and synonym map as the booking
// allergy warning (findAllergyConflicts, D-24 and D-32), so a search that avoids "gluten" also
// leaves out a dish that lists "wheat" or "barley". This is a convenience filter, not an allergy
// guarantee: the booking flow still checks the intake form.
import { findAllergyConflicts } from "./allergy.ts";

export interface DietaryDish {
  isActive: boolean;
  allergens: readonly string[];
}

const norm = (s: string) => s.trim().toLowerCase();

export function dishAvoidsAllergens(
  dish: DietaryDish,
  avoid: readonly string[],
): boolean {
  const wanted = avoid.map(norm).filter(Boolean);
  if (wanted.length === 0) return true;
  return (
    findAllergyConflicts(wanted, [
      { id: "d", name: "d", allergens: dish.allergens },
    ]).length === 0
  );
}

export function chefMatchesDietary(
  dishes: readonly DietaryDish[],
  avoid: readonly string[],
): boolean {
  if (avoid.map(norm).filter(Boolean).length === 0) return true;
  return dishes.some((d) => d.isActive && dishAvoidsAllergens(d, avoid));
}
