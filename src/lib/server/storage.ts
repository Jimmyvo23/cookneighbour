// Server-only Storage helpers. They take the service-role client, so call them only after the
// route's own checks (contract section 2). Object names are validated by the caller first
// (checkStoragePath), so nothing here is built from raw user input.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * True when the object exists in the bucket. Uses the service role (the chef cannot read back
 * ID documents), so a client cannot register a path it never uploaded.
 * A missing object (400/404) is `false`; any other storage failure throws and becomes a 500.
 */
export async function objectExists(
  admin: SupabaseClient,
  bucket: string,
  path: string,
): Promise<boolean> {
  const { data } = await admin.storage.from(bucket).exists(path);
  return data === true;
}

/**
 * Best-effort delete. The database no longer points at the object when this runs, so a failure
 * only leaves an orphaned file: log a generic line (never the path or file content) and go on.
 */
export async function removeObject(
  admin: SupabaseClient,
  bucket: string,
  path: string,
): Promise<void> {
  try {
    const { error } = await admin.storage.from(bucket).remove([path]);
    if (error) console.error("api: storage remove failed:", error.message);
  } catch (e) {
    console.error(
      "api: storage remove failed:",
      e instanceof Error ? e.message : "unknown",
    );
  }
}
