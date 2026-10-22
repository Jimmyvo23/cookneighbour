// Saved allergy profile (T-067, D-38): the customer's own intake answers, used to prefill the
// booking form. Customers only. Read through the user-scoped client (row-level security: own row);
// written by the server only, after the same validation as the booking intake (D-23).
import { fieldsFailure, handle, json } from "@/lib/api/errors";
import { readJsonObject, requireJson } from "@/lib/api/request";
import type { SavedIntakeResponse } from "@/lib/api/types";
import { parseSavedIntake, readSavedIntake } from "@/lib/domain/savedIntake";
import { requireCustomer } from "@/lib/server/bookings";
import { createAdminClient } from "@/lib/supabase/admin";

type Db = {
  saved_intake: unknown;
  saved_intake_at: string | null;
} | null;

function shape(row: Db): SavedIntakeResponse {
  const intake = row ? readSavedIntake(row.saved_intake) : null;
  // Postgres returns "…+00:00"; normalise to the canonical JS ISO form ("…Z") that PUT returns.
  const at = intake ? row?.saved_intake_at : null;
  return { intake, savedAt: at ? new Date(at).toISOString() : null };
}

export function GET() {
  return handle(async () => {
    const caller = await requireCustomer();
    const { data, error } = await caller.supabase
      .from("profile_private")
      .select("saved_intake, saved_intake_at")
      .eq("profile_id", caller.userId)
      .maybeSingle();
    if (error) throw new Error(`saved intake load failed: ${error.message}`);
    return json(shape(data));
  });
}

export function PUT(request: Request) {
  return handle(async () => {
    const caller = await requireCustomer();
    const body = await readJsonObject(request);
    const parsed = parseSavedIntake(body);
    if (!parsed.ok) throw fieldsFailure(parsed.fields);
    const savedAt = new Date().toISOString();
    // Only the caller's own row (id from the session, never the body).
    const up = await createAdminClient().from("profile_private").upsert(
      {
        profile_id: caller.userId,
        saved_intake: parsed.form,
        saved_intake_at: savedAt,
      },
      { onConflict: "profile_id" },
    );
    if (up.error)
      throw new Error(`saved intake save failed: ${up.error.message}`);
    return json<SavedIntakeResponse>({ intake: parsed.form, savedAt });
  });
}

export function DELETE(request: Request) {
  return handle(async () => {
    // Order of checks: session (401), role (403), then content type (400).
    const caller = await requireCustomer();
    requireJson(request); // same CSRF content-type rule as every state-changing route
    const up = await createAdminClient()
      .from("profile_private")
      .update({ saved_intake: null, saved_intake_at: null })
      .eq("profile_id", caller.userId);
    if (up.error)
      throw new Error(`saved intake clear failed: ${up.error.message}`);
    return json<SavedIntakeResponse>({ intake: null, savedAt: null });
  });
}
