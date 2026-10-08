"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, isMockEnabled } from "@/lib/api/client";
import { MockBadge } from "@/components/MockBadge";
import type { LogoutResponse, MeResponse } from "@/lib/api/types";

export function AccountBar() {
  const [me, setMe] = useState<MeResponse | null | undefined>(undefined);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  // Layout persists across client navigation, so re-check the session on every route change.
  useEffect(() => {
    apiFetch<MeResponse>("/api/me").then(setMe, () => setMe(null));
  }, [pathname]);
  async function logout() {
    setLogoutError(null);
    try {
      await apiFetch<LogoutResponse>("/api/auth/logout", { method: "POST" });
    } catch {
      // Stay signed in: the server session may still be alive.
      setLogoutError("Could not log out. You are still signed in. Try again.");
      return;
    }
    setMe(null);
    router.push("/");
  }
  const cls = "inline-flex min-h-11 items-center px-2 font-medium underline";
  return (
    <nav
      aria-label="Account"
      className="flex items-center justify-end gap-2 px-4 pt-2 text-sm"
    >
      {isMockEnabled() && (
        <MockBadge className="mr-auto">MOCK API — no real data</MockBadge>
      )}
      {logoutError && (
        <span
          role="alert"
          className="font-medium text-red-700 dark:text-red-400"
        >
          {logoutError}
        </span>
      )}
      {me === undefined ? null : me ? (
        <>
          <span>Signed in as {me.profile.displayName}</span>
          <button type="button" onClick={logout} className={cls}>
            Log out
          </button>
        </>
      ) : (
        <>
          <Link className={cls} href="/login">
            Log in
          </Link>
          <Link className={cls} href="/signup">
            Sign up
          </Link>
        </>
      )}
    </nav>
  );
}
