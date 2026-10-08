import { ApiFailure, handle, json, validationFailed } from "@/lib/api/errors";
import { limiterKey, rateLimit } from "@/lib/api/rate-limit";
import { clientIp, readJsonObject, rejectUnknownKeys } from "@/lib/api/request";
import type { SignUpResponse } from "@/lib/api/types";
import { Fields, isEmail } from "@/lib/api/validate";
import { loadProfile } from "@/lib/server/me";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export function POST(request: Request) {
  return handle(async () => {
    const body = await readJsonObject(request);
    // PLACEHOLDER limit: 10 sign-ups per hour per IP (contract section 9). In-memory.
    rateLimit(limiterKey("signup", clientIp(request)), 10, 3600);
    rejectUnknownKeys(body, ["email", "password", "role", "displayName"]);

    const f = new Fields();
    const email = f.string(body, "email", 1, 254).toLowerCase();
    if (!f.errors.email && !isEmail(email))
      f.errors.email = "Enter a valid email address.";
    const password = body.password;
    if (
      typeof password !== "string" ||
      password.length < 8 ||
      password.length > 72
    )
      f.errors.password = "Use 8 to 72 characters.";
    const role = body.role;
    if (role !== "customer" && role !== "chef")
      f.errors.role = "Choose customer or chef.";
    const displayName = f.string(body, "displayName", 1, 80);
    f.done();

    const supabase = await createClient();
    const existing = await supabase.auth.getUser();
    if (existing.data.user)
      throw new ApiFailure("INVALID_STATE", "You are already signed in.");

    // Only role and display_name are sent as metadata. The database trigger decides the real
    // role: anything other than "chef" becomes "customer", and "admin" is impossible.
    const { data, error } = await supabase.auth.signUp({
      email,
      password: password as string,
      options: { data: { role, display_name: displayName } },
    });
    if (error) {
      if (
        error.code === "user_already_exists" ||
        /already (been )?registered/i.test(error.message)
      )
        throw new ApiFailure(
          "EMAIL_IN_USE",
          "An account with this email already exists.",
        );
      if (error.status === 429 || error.code === "over_request_rate_limit")
        throw new ApiFailure(
          "RATE_LIMITED",
          "Too many attempts. Please try again later.",
          {
            retryAfterSeconds: 60,
          },
        );
      if (
        error.status === 422 ||
        error.code === "weak_password" ||
        error.code === "validation_failed"
      )
        throw validationFailed({ password: "Choose a different password." });
      throw new Error(`signUp failed: ${error.code ?? error.status}`);
    }
    const user = data.user;
    // With email confirmation on, an existing email returns a user with no identities.
    if (!user || user.identities?.length === 0)
      throw new ApiFailure(
        "EMAIL_IN_USE",
        "An account with this email already exists.",
      );

    const admin = createAdminClient();
    if (role === "chef") {
      // Service role: there is no client insert policy on these tables. Idempotent.
      const c1 = await admin
        .from("chefs")
        .upsert(
          { profile_id: user.id, status: "pending", display_name: displayName },
          { onConflict: "profile_id", ignoreDuplicates: true },
        );
      const c2 = await admin
        .from("chef_private")
        .upsert(
          { chef_id: user.id },
          { onConflict: "chef_id", ignoreDuplicates: true },
        );
      if (c1.error || c2.error)
        throw new Error(
          `chef rows failed: ${c1.error?.message ?? c2.error?.message}`,
        );
    }
    const out: SignUpResponse = {
      user: await loadProfile(admin, user.id),
      signedIn: Boolean(data.session),
    };
    return json(out, 201);
  });
}
