// A real admin account for the real-route Playwright tests. Only for the THROWAWAY LOCAL Supabase
// stack (it refuses any other host). The admin role is set the way the app does it: the server
// writes profiles.role; no route lets anyone become an admin.
import { createClient } from "@supabase/supabase-js";

export const ADMIN_PASSWORD = "e2e-admin-password-1";

export async function createLocalAdmin(): Promise<{
  email: string;
  password: string;
  id: string;
}> {
  const url = process.env.API_URL ?? "";
  const key = process.env.SERVICE_ROLE_KEY ?? process.env.SECRET_KEY ?? "";
  const host = url ? new URL(url).hostname : "";
  if (!key || (host !== "127.0.0.1" && host !== "localhost"))
    throw new Error(
      "createLocalAdmin only runs against the local Supabase stack",
    );
  const svc = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `e2e-admin-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}@example.com`;
  const created = await svc.auth.admin.createUser({
    email,
    password: ADMIN_PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: "E2E Admin", role: "customer" },
  });
  if (created.error || !created.data.user)
    throw new Error(`createUser failed: ${created.error?.message}`);
  const id = created.data.user.id;
  const upd = await svc.from("profiles").update({ role: "admin" }).eq("id", id);
  if (upd.error) throw new Error(`promote admin failed: ${upd.error.message}`);
  return { email, password: ADMIN_PASSWORD, id };
}
