import { handle, json, validationFailed } from "@/lib/api/errors";
import { readJsonObject, rejectUnknownKeys } from "@/lib/api/request";
import { Fields } from "@/lib/api/validate";
import { requireCaller } from "@/lib/server/caller";
import { loadMe, loadProfile } from "@/lib/server/me";
import { createAdminClient } from "@/lib/supabase/admin";

export function GET() {
  return handle(async () => {
    const caller = await requireCaller();
    return json(await loadMe(caller.supabase, caller.userId));
  });
}

export function PATCH(request: Request) {
  return handle(async () => {
    const caller = await requireCaller();
    const body = await readJsonObject(request);
    rejectUnknownKeys(body, ["displayName"]);
    const admin = createAdminClient();
    if (body.displayName === undefined)
      return json(await loadProfile(admin, caller.userId));
    const f = new Fields();
    const displayName = f.text(body, "displayName", 1, 80);
    f.done();
    if (!displayName) throw validationFailed({ displayName: "Required." });

    // Service role: clients cannot update profiles. The id is the session user, never the body.
    const p = await admin
      .from("profiles")
      .update({ display_name: displayName })
      .eq("id", caller.userId);
    if (p.error) throw new Error(`profile update failed: ${p.error.message}`);
    if (caller.role === "chef") {
      // Denormalized copy for the public listing, same request.
      const c = await admin
        .from("chefs")
        .update({ display_name: displayName })
        .eq("profile_id", caller.userId);
      if (c.error)
        throw new Error(`chef name update failed: ${c.error.message}`);
    }
    return json(await loadProfile(admin, caller.userId));
  });
}
