import { ApiFailure, handle, json } from "@/lib/api/errors";
import { limiterKey, rateLimit } from "@/lib/api/rate-limit";
import { clientIp, readJsonObject, rejectUnknownKeys } from "@/lib/api/request";
import type { LoginResponse } from "@/lib/api/types";
import { Fields } from "@/lib/api/validate";
import { loadProfile } from "@/lib/server/me";
import { createClient } from "@/lib/supabase/server";

export function POST(request: Request) {
  return handle(async () => {
    const body = await readJsonObject(request);
    rejectUnknownKeys(body, ["email", "password"]);
    const f = new Fields();
    const email = f.string(body, "email", 1, 254).toLowerCase();
    if (
      typeof body.password !== "string" ||
      body.password.length === 0 ||
      body.password.length > 200
    )
      f.errors.password = "Required.";
    f.done();
    // PLACEHOLDER limit: 10 attempts per 15 minutes per IP and email (contract section 9). In-memory.
    rateLimit(limiterKey("login", clientIp(request), email), 10, 900);

    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: body.password as string,
    });
    if (error || !data.user) {
      if (
        error &&
        (error.status === 429 || error.code === "over_request_rate_limit")
      )
        throw new ApiFailure(
          "RATE_LIMITED",
          "Too many attempts. Please try again later.",
          {
            retryAfterSeconds: 60,
          },
        );
      if (error && error.status !== undefined && error.status >= 500)
        throw new Error(`signIn failed: ${error.code ?? error.status}`);
      // One message for unknown email and wrong password.
      throw new ApiFailure(
        "INVALID_CREDENTIALS",
        "Email or password is incorrect.",
      );
    }
    const out: LoginResponse = {
      user: await loadProfile(supabase, data.user.id),
    };
    return json(out);
  });
}
