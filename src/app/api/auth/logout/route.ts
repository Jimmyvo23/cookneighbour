import { handle, json } from "@/lib/api/errors";
import { requireJson } from "@/lib/api/request";
import type { LogoutResponse } from "@/lib/api/types";
import { createClient } from "@/lib/supabase/server";

export function POST(request: Request) {
  return handle(async () => {
    requireJson(request);
    const supabase = await createClient();
    await supabase.auth.signOut(); // no session is fine: still 200
    const out: LogoutResponse = { ok: true };
    return json(out);
  });
}
