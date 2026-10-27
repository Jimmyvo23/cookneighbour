"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import type { MeResponse } from "@/lib/api/types";

// T-136 (D-209): signed out -> /signup, chef -> /chef/apply, customer and admin -> no link.
// While the session loads, or if it fails, show the signed-out link (same as a visitor).
export function LoveToCookLink() {
  const [me, setMe] = useState<MeResponse | null>(null);
  useEffect(() => {
    let current = true;
    apiFetch<MeResponse>("/api/me").then(
      (m) => {
        if (current) setMe(m);
      },
      () => {
        if (current) setMe(null);
      },
    );
    return () => {
      current = false;
    };
  }, []);
  const role = me?.profile.role;
  if (role === "customer" || role === "admin") return null;
  return (
    <Link
      href={role === "chef" ? "/chef/apply" : "/signup"}
      className="home-love"
    >
      I love to cook
    </Link>
  );
}
