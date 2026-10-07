// Server-only admin client. Uses the secret (service-role) key and BYPASSES row-level security.
// The "server-only" import makes the build fail if this file is ever imported into browser code.
// Use only for trusted server work (seed data, admin actions). Never pass it to the browser.
import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getServiceSupabaseEnv } from "./env";

export function createAdminClient() {
  const { url, secretKey } = getServiceSupabaseEnv();
  return createSupabaseClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
