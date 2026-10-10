// Dietary filter for search (A-17, pending Jimmy). Chefs have no dietary data, so "dietary needs"
// means allergen exclusion: a chef matches when at least one ACTIVE dish contains none of the
// selected allergens. Lower-case, trimmed compare, same as the stored dish allergens. This is a
// convenience filter, not an allergy guarantee: the booking flow still checks the intake form.
export interface DietaryDish {
  isActive: boolean;
  allergens: readonly string[];
}

const norm = (s: string) => s.trim().toLowerCase();

export function dishAvoidsAllergens(
  dish: DietaryDish,
  avoid: readonly string[],
): boolean {
  const wanted = new Set(avoid.map(norm).filter(Boolean));
  return dish.allergens.every((a) => !wanted.has(norm(a)));
}

export function chefMatchesDietary(
  dishes: readonly DietaryDish[],
  avoid: readonly string[],
): boolean {
  if (avoid.map(norm).filter(Boolean).length === 0) return true;
  return dishes.some((d) => d.isActive && dishAvoidsAllergens(d, avoid));
}
