// Server-side guard for pages that show private data (T-033; lessons-learned section 3).
// Runs on the server before any private UI is sent, so it does not rely on client code.
// Identity comes from getUser() and the role from profiles.role (see caller.ts), never from the
// client. In MOCK API mode (NEXT_PUBLIC_API_MOCK=1) there is no server session, so the guard is
// skipped and only the client layer applies. That mode never holds real data.
import "server-only";
import { redirect } from "next/navigation";
import { ApiFailure } from "@/lib/api/errors";
import { isMockEnabled } from "@/lib/api/client";
import { requireCaller } from "@/lib/server/caller";

/** Where a visitor with this session state belongs, or null when a chef may see the page. */
export function chefPageRedirect(
  caller: { role: string } | null,
): string | null {
  if (!caller) return "/login";
  return caller.role === "chef" ? null : "/";
}

export async function requireChefPage(): Promise<void> {
  if (isMockEnabled()) return; // MOCK mode: no server session exists
  let target: string | null;
  try {
    target = chefPageRedirect(await requireCaller());
  } catch (err) {
    if (err instanceof ApiFailure && err.code === "UNAUTHENTICATED")
      target = chefPageRedirect(null);
    else throw err;
  }
  if (target) redirect(target);
}
