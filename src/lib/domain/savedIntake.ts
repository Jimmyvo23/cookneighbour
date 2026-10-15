// Saved allergy profile (T-067, D-38). The customer's allergies and dietary notes live on their
// own profile (profile_private.saved_intake) and prefill the booking intake form. Same rules as
// the booking intake (D-23: explicit answers, blank refused; shared text-safety helpers), so
// a saved form can always be sent as the booking's `intake` unchanged. A booking keeps its own
// copy (intake_forms); editing the profile never changes an existing booking.
import { parseIntake, type IntakeForm } from "./bookingRequest.ts";

export type SavedIntake = IntakeForm;

/** Validates a PUT body. Field keys are plain (`allergies`, `allergens`...), not `intake.`-prefixed. */
export function parseSavedIntake(
  body: unknown,
):
  | { ok: true; form: SavedIntake }
  | { ok: false; fields: Record<string, string> } {
  const r = parseIntake(body);
  const fields: Record<string, string> = {};
  for (const [k, m] of Object.entries({ ...r.invalid, ...r.incomplete })) {
    fields[k === "intake" ? "body" : k.replace(/^intake\./, "")] = m;
  }
  if (!r.form || Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, form: r.form };
}

/** Reads the stored jsonb defensively; anything that is not a valid form counts as "nothing saved". */
export function readSavedIntake(raw: unknown): SavedIntake | null {
  const r = parseSavedIntake(raw);
  return r.ok ? r.form : null;
}
