import { ApiFailure, handle, json, validationFailed } from "@/lib/api/errors";
import { limiterKey, rateLimit } from "@/lib/api/rate-limit";
import { clientIp, readJsonObject, rejectUnknownKeys } from "@/lib/api/request";
import type { PhoneSubmitResponse } from "@/lib/api/types";
import { maskPhone, normalizePhone } from "@/lib/domain/phone";
import { phoneColumns } from "@/lib/domain/private-rows";
import { requireCaller } from "@/lib/server/caller";
import { getHashPepper } from "@/lib/server/pepper";
import { createAdminClient } from "@/lib/supabase/admin";

export function POST(request: Request) {
  return handle(async () => {
    const caller = await requireCaller();
    const body = await readJsonObject(request);
    // PLACEHOLDER limits (contract section 9): 5/hour per account, 10/hour per IP. In-memory.
    // Keys are hashes of ids; the phone number is never part of a key.
    rateLimit(limiterKey("phone", caller.userId), 5, 3600);
    rateLimit(limiterKey("phone-ip", clientIp(request)), 10, 3600);
    rejectUnknownKeys(body, ["phone"]);
    const phone =
      typeof body.phone === "string" ? normalizePhone(body.phone) : null;
    if (!phone)
      throw validationFailed({ phone: "Enter a valid Canadian phone number." });

    const cols = phoneColumns(phone, getHashPepper());
    const admin = createAdminClient();
    const current = await admin
      .from("profile_private")
      .select("phone_hash, phone_verified")
      .eq("profile_id", caller.userId)
      .maybeSingle();
    if (current.error)
      throw new Error(`phone lookup failed: ${current.error.message}`);

    // Another account already verified this number (contract section 8). The message does not say who.
    const taken = await admin
      .from("profile_private")
      .select("profile_id")
      .eq("phone_hash", cols.phone_hash)
      .eq("phone_verified", true)
      .neq("profile_id", caller.userId)
      .limit(1);
    if (taken.error)
      throw new Error(`phone check failed: ${taken.error.message}`);
    if (taken.data.length > 0)
      throw new ApiFailure("PHONE_IN_USE", "This phone number cannot be used.");

    // Resubmitting the same number keeps its verified state; a different number resets it.
    const same = current.data?.phone_hash === cols.phone_hash;
    const up = await admin.from("profile_private").upsert(
      {
        profile_id: caller.userId,
        ...cols,
        phone_verified: same ? Boolean(current.data?.phone_verified) : false,
      },
      { onConflict: "profile_id" },
    );
    if (up.error) throw new Error(`phone save failed: ${up.error.message}`);

    const out: PhoneSubmitResponse = {
      phoneMasked: maskPhone(phone),
      mock: true,
      mockHint: "MOCK: no SMS was sent. Enter any 6 digits.",
    };
    return json(out);
  });
}
