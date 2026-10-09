// Intake-form part of booking validation: the form is mandatory, and an allergy that matches a
// chosen dish's allergens must be acknowledged by the customer (CLAUDE.md 6.4, 10).
import {
  findAllergyConflicts,
  type AllergyConflict,
  type DishAllergens,
} from "./allergy.ts";

export function allergyAcknowledgementIssue(
  intake: { allergies: string; dietaryNotes: string } | undefined,
  dishes: readonly DishAllergens[],
  acknowledged: boolean,
): {
  conflicts: AllergyConflict[];
  error?: {
    code: "INTAKE_MISSING" | "ALLERGY_NOT_ACKNOWLEDGED";
    message: string;
  };
} {
  if (
    !intake ||
    typeof intake.allergies !== "string" ||
    typeof intake.dietaryNotes !== "string"
  )
    return {
      conflicts: [],
      error: {
        code: "INTAKE_MISSING",
        message: "Complete the allergies and dietary notes form.",
      },
    };
  // Unique dishes only: the same dish on two days is one conflict.
  const unique = [...new Map(dishes.map((d) => [d.id, d])).values()];
  const conflicts = findAllergyConflicts(intake.allergies, unique);
  if (conflicts.length > 0 && !acknowledged)
    return {
      conflicts,
      error: {
        code: "ALLERGY_NOT_ACKNOWLEDGED",
        message:
          "A dish contains an allergen you listed. Confirm you understand, or remove the dish.",
      },
    };
  return { conflicts };
}
