import { ApiFailure, handle, json, validationFailed } from "@/lib/api/errors";
import { limiterKey, rateLimit } from "@/lib/api/rate-limit";
import { readJsonObject, rejectUnknownKeys } from "@/lib/api/request";
import type { PhoneVerifyResponse } from "@/lib/api/types";
import { requireCaller } from "@/lib/server/caller";
import { MOCK_SMS_ENABLED } from "@/lib/server/mock-sms";
import { createAdminClient } from "@/lib/supabase/admin";

export function POST(request: Request) {
  return handle(async () => {
    const caller = await requireCaller();
    const body = await readJsonObject(request);
    // PLACEHOLDER limit: 10 per hour per account (contract section 9). In-memory.
    rateLimit(limiterKey("phone-verify", caller.userId), 10, 3600);
    rejectUnknownKeys(body, ["code"]);
    if (typeof body.code !== "string" || !/^\d{6}$/.test(body.code))
      throw validationFailed({ code: "Enter the 6-digit code." });
    // MOCK: real SMS is out of scope. Without the mock switch we refuse rather than pretend.
    if (!MOCK_SMS_ENABLED)
      throw new Error("MOCK_SMS_ENABLED is false and no real SMS exists");

    const admin = createAdminClient();
    const cur = await admin
      .from("profile_private")
      .select("phone_hash, phone_verified")
      .eq("profile_id", caller.userId)
      .maybeSingle();
    if (cur.error) throw new Error(`phone lookup failed: ${cur.error.message}`);
    if (!cur.data?.phone_hash)
      throw new ApiFailure(
        "PHONE_NOT_SUBMITTED",
        "Submit a phone number first.",
      );
    if (!cur.data.phone_verified) {
      const up = await admin
        .from("profile_private")
        .update({ phone_verified: true })
        .eq("profile_id", caller.userId)
        .not("phone_hash", "is", null);
      if (up.error) {
        // Unique index on verified phone hashes: another account won the race.
        if (up.error.code === "23505")
          throw new ApiFailure(
            "PHONE_IN_USE",
            "This phone number cannot be used.",
          );
        throw new Error(`verify failed: ${up.error.message}`);
      }
    }
    const out: PhoneVerifyResponse = { phoneVerified: true, mock: true };
    return json(out);
  });
}
