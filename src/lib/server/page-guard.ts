// Server-side guard for pages that show private data (T-033; lessons-learned section 3).
// Runs on the server before any private UI is sent, so it does not rely on client code.
// Identity comes from getUser() and the role from profiles.role (see caller.ts), never from the
// client. In MOCK API mode (NEXT_PUBLIC_API_MOCK=1) there is no server session, so the guard is
// skipped and only the client layer applies. That mode never holds real data.
import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ApiFailure } from "@/lib/api/errors";
import { isMockEnabled } from "@/lib/api/client";
import { requireCaller } from "@/lib/server/caller";

/** Where a visitor with this session state belongs, or null when a chef may see the page. */
export function chefPageRedirect(
  caller: { role: string } | null,
): string | null {
  return roleRedirect(caller, "chef");
}

/** Same for admin pages (T-036): only an admin stays; a visitor goes to /login, anyone else home. */
export function adminPageRedirect(
  caller: { role: string } | null,
): string | null {
  return roleRedirect(caller, "admin");
}

/** Same for customer pages (T-043: booking flow and my bookings). Chefs and admins go home. */
export function customerPageRedirect(
  caller: { role: string } | null,
): string | null {
  return roleRedirect(caller, "customer");
}

function roleRedirect(
  caller: { role: string } | null,
  role: "chef" | "admin" | "customer",
): string | null {
  if (!caller) return "/login";
  return caller.role === role ? null : "/";
}

export const requireChefPage = () => requirePage(chefPageRedirect);
export const requireAdminPage = () => requirePage(adminPageRedirect);
export const requireCustomerPage = () => requirePage(customerPageRedirect);

async function requirePage(
  redirectFor: (caller: { role: string } | null) => string | null,
): Promise<void> {
  // Request-time only: never run (or read env) while prerendering the page shell at build time.
  await connection();
  if (isMockEnabled()) return; // MOCK mode: no server session exists
  let target: string | null;
  try {
    target = redirectFor(await requireCaller());
  } catch (err) {
    // Fail closed: only "no session" means "visitor"; any other error is thrown, never a free pass.
    if (err instanceof ApiFailure && err.code === "UNAUTHENTICATED")
      target = redirectFor(null);
    else throw err;
  }
  if (target) redirect(target);
}
