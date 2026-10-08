import { handle, json, validationFailed } from "@/lib/api/errors";
import { readJsonObject, rejectUnknownKeys } from "@/lib/api/request";
import type { AddressResponse } from "@/lib/api/types";
import { Fields } from "@/lib/api/validate";
import { normalizePostalCode, postalPrefix } from "@/lib/domain/address";
import { addressColumns } from "@/lib/domain/private-rows";
import { requireCaller } from "@/lib/server/caller";
import { getHashPepper } from "@/lib/server/pepper";
import { createAdminClient } from "@/lib/supabase/admin";

export function PUT(request: Request) {
  return handle(async () => {
    const caller = await requireCaller();
    const body = await readJsonObject(request);
    rejectUnknownKeys(body, ["line", "city", "postalCode"]);
    const f = new Fields();
    const line = f.text(body, "line", 1, 120);
    const city = f.text(body, "city", 1, 80);
    const raw = typeof body.postalCode === "string" ? body.postalCode : "";
    const postal = normalizePostalCode(raw);
    if (!postal)
      f.errors.postalCode = "Enter a valid postal code, for example L5B 1A1.";
    f.done();

    const admin = createAdminClient();
    const pre = await admin
      .from("postal_prefixes")
      .select("prefix")
      .eq("prefix", postalPrefix(postal as string))
      .maybeSingle();
    if (pre.error)
      throw new Error(`prefix lookup failed: ${pre.error.message}`);
    if (!pre.data)
      throw validationFailed({ postalCode: "Not a GTA postal code." });

    const cols = addressColumns(line, city, postal as string, getHashPepper());
    // Written only to the caller's own row (id from the session).
    const up = await admin
      .from("profile_private")
      .upsert(
        { profile_id: caller.userId, ...cols },
        { onConflict: "profile_id" },
      );
    if (up.error) throw new Error(`address save failed: ${up.error.message}`);
    const out: AddressResponse = {
      address: {
        line: cols.address_line,
        city: cols.city,
        postalCode: cols.postal_code,
        postalPrefix: cols.postal_prefix,
      },
    };
    return json(out);
  });
}
