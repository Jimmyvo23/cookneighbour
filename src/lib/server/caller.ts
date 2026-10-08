// Who is calling? (contract section 2, rules 1 and 2)
// Identity comes from getUser() (re-validated with Supabase), never getSession() or the body.
// The role comes from profiles.role in the database, never from JWT metadata.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiFailure } from "@/lib/api/errors";
import type { UserRole } from "@/lib/api/types";
import { createClient } from "@/lib/supabase/server";

export interface Caller {
  supabase: SupabaseClient;
  userId: string;
  role: UserRole;
}

export async function requireCaller(): Promise<Caller> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user)
    throw new ApiFailure("UNAUTHENTICATED", "Please sign in.");
  const { data: profile, error: pe } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();
  if (pe) throw new Error(`profile lookup failed: ${pe.message}`);
  if (!profile) throw new ApiFailure("UNAUTHENTICATED", "Please sign in.");
  return { supabase, userId: data.user.id, role: profile.role as UserRole };
}
