"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import type { LogoutResponse, MeResponse } from "@/lib/api/types";

export function AccountBar() {
  const [me, setMe] = useState<MeResponse | null | undefined>(undefined);
  const pathname = usePathname();
  // Layout persists across client navigation, so re-check the session on every route change.
  useEffect(() => {
    apiFetch<MeResponse>("/api/me").then(setMe, () => setMe(null));
  }, [pathname]);
  async function logout() {
    try {
      await apiFetch<LogoutResponse>("/api/auth/logout", { method: "POST" });
    } finally {
      setMe(null);
    }
  }
  const cls = "inline-flex min-h-11 items-center px-2 font-medium underline";
  return (
    <nav
      aria-label="Account"
      className="flex items-center justify-end gap-2 px-4 pt-2 text-sm"
    >
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
