// Saved allergy profile helpers (T-067, D-38). Pure: no network, no DOM. The server stays the
// authority (contract section 4A); these only move the five intake answers between the saved
// profile and the booking form draft.
import type { SavedIntake } from "@/lib/api/types";
import type { BookingDraft } from "@/lib/booking/form";

export type IntakeFields = Pick<
  BookingDraft,
  | "noAllergies"
  | "allergens"
  | "allergyNotes"
  | "noDietaryNeeds"
  | "dietaryNotes"
>;

/** The draft fields a saved profile fills in. The conflict tick always starts unticked. */
export function draftFromSaved(
  s: SavedIntake,
): IntakeFields & { conflictAcknowledged: false } {
  return {
    noAllergies: s.noAllergies,
    allergens: [...s.allergens],
    allergyNotes: s.allergyNotes,
    noDietaryNeeds: s.noDietaryNeeds,
    dietaryNotes: s.dietaryNotes,
    conflictAcknowledged: false,
  };
}

/** The body for PUT /api/me/intake: every field present, text trimmed, same rules as the booking. */
export function intakeFromDraft(d: IntakeFields): SavedIntake {
  return {
    noAllergies: d.noAllergies,
    allergens: d.noAllergies ? [] : [...d.allergens],
    allergyNotes: d.noAllergies ? "" : d.allergyNotes.trim(),
    noDietaryNeeds: d.noDietaryNeeds,
    dietaryNotes: d.noDietaryNeeds ? "" : d.dietaryNotes.trim(),
  };
}

function norm(s: SavedIntake) {
  return JSON.stringify({
    a: s.noAllergies,
    g: [...new Set(s.allergens.map((x) => x.trim().toLowerCase()))].sort(),
    n: s.allergyNotes.trim(),
    d: s.noDietaryNeeds,
    t: s.dietaryNotes.trim(),
  });
}

/** True when two forms say the same thing (case, order and outer spaces do not matter). */
export function sameIntake(a: SavedIntake, b: SavedIntake): boolean {
  return norm(a) === norm(b);
}

/** True while the customer has answered nothing, so a late-loading profile may fill the form. */
export function intakeIsUntouched(d: IntakeFields): boolean {
  return (
    !d.noAllergies &&
    !d.noDietaryNeeds &&
    d.allergens.length === 0 &&
    d.allergyNotes === "" &&
    d.dietaryNotes === ""
  );
}
