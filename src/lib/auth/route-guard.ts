import type { MeResponse } from "@/lib/api/types";

/** The next sign-up step a signed-in user still owes, or null when they are done.
 *  Uses GET /api/me fields: private.phoneVerified, then private.address (docs/api-contract.md). */
export function nextOnboardingStep(
  me: MeResponse,
): "/verify-phone" | "/address" | null {
  if (!me.private.phoneVerified) return "/verify-phone";
  if (!me.private.address) return "/address";
  return null;
}

/** Where a signed-in user goes after log-in or finishing sign-up: the next onboarding step, else
 *  the chef application for chefs, else home. */
export function landingPath(me: MeResponse): string {
  return (
    nextOnboardingStep(me) ?? (me.profile.role === "chef" ? "/chef/apply" : "/")
  );
}

/** Chef-only pages live under /chef/. The server guard is authoritative; this is the client layer. */
function isChefPage(pathname: string): boolean {
  return pathname === "/chef" || pathname.startsWith("/chef/");
}

/** Where to send the visitor from `pathname`, or null to stay. `me` is null when signed out. */
export function redirectFor(
  pathname: string,
  me: MeResponse | null,
): string | null {
  if (isChefPage(pathname)) {
    if (!me) return "/login";
    return me.profile.role === "chef" ? null : "/";
  }
  if (!me) {
    return pathname === "/verify-phone" || pathname === "/address"
      ? "/login"
      : null;
  }
  if (pathname === "/signup" || pathname === "/login") return "/";
  // The address step comes after the phone step.
  if (pathname === "/address" && !me.private.phoneVerified)
    return "/verify-phone";
  return null;
}
