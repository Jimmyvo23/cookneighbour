"use client";
// The two intake questions (allergies, dietary needs), shared by the booking form and the saved
// profile page (T-067) so both ask the same thing in the same words. Error keys are the booking's
// `intake.allergies` and `intake.dietaryNotes`. Must sit inside a FieldScopeProvider.
import type { BookingDraft } from "@/lib/booking/form";
import { ALLERGEN_CHOICES } from "@/lib/chef/dishes";
import {
  Choice,
  Question,
  TextArea,
  useDomId,
} from "@/components/booking/parts";

export function IntakeFields({
  draft,
  errors,
  patch,
  afterAllergies,
}: {
  draft: BookingDraft;
  errors: Record<string, string>;
  patch: (p: Partial<BookingDraft>, clear?: string[]) => void;
  /** Rendered between the two questions (the booking form puts its allergy warning here). */
  afterAllergies?: React.ReactNode;
}) {
  const noAllergiesId = useDomId("intake.allergies-none");
  const noDietId = useDomId("intake.dietaryNotes-none");
  return (
    <>
      <Question
        legend="Allergies"
        errorKey="intake.allergies"
        error={errors["intake.allergies"]}
      >
        <Choice
          type="checkbox"
          label="I have no allergies"
          checked={draft.noAllergies}
          onChange={(c) =>
            patch(
              c
                ? {
                    noAllergies: true,
                    allergens: [],
                    allergyNotes: "",
                    conflictAcknowledged: false,
                  }
                : { noAllergies: false },
              ["intake.allergies", "allergyConflictAcknowledged"],
            )
          }
          id={noAllergiesId}
        />
        <div
          role="group"
          aria-label="Allergens"
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          {ALLERGEN_CHOICES.map((a) => (
            <Choice
              key={a.value}
              type="checkbox"
              label={a.label}
              disabled={draft.noAllergies}
              checked={draft.allergens.includes(a.value)}
              onChange={(c) =>
                patch(
                  {
                    allergens: c
                      ? [...draft.allergens, a.value]
                      : draft.allergens.filter((x) => x !== a.value),
                  },
                  ["intake.allergies", "allergyConflictAcknowledged"],
                )
              }
            />
          ))}
        </div>
        <TextArea
          label="Other allergies or details (optional)"
          errorKey="intake.allergies"
          maxLength={300}
          disabled={draft.noAllergies}
          value={draft.allergyNotes}
          onChange={(e) =>
            patch({ allergyNotes: e.target.value }, [
              "intake.allergies",
              "allergyConflictAcknowledged",
            ])
          }
        />
      </Question>

      {afterAllergies}

      <Question
        legend="Dietary needs"
        errorKey="intake.dietaryNotes"
        error={errors["intake.dietaryNotes"]}
      >
        <Choice
          type="checkbox"
          label="I have no dietary needs"
          checked={draft.noDietaryNeeds}
          onChange={(c) =>
            patch(
              c
                ? { noDietaryNeeds: true, dietaryNotes: "" }
                : { noDietaryNeeds: false },
              ["intake.dietaryNotes"],
            )
          }
          id={noDietId}
        />
        <TextArea
          label="Dietary needs (for example halal, vegetarian, low salt)"
          errorKey="intake.dietaryNotes"
          maxLength={500}
          disabled={draft.noDietaryNeeds}
          value={draft.dietaryNotes}
          onChange={(e) =>
            patch({ dietaryNotes: e.target.value }, ["intake.dietaryNotes"])
          }
        />
      </Question>
    </>
  );
}
