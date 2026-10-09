"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Navigation between the admin pages. The current page is marked for screen readers and with an
 *  underline, not by colour alone. */
export function AdminNav() {
  const pathname = usePathname();
  const current = pathname === "/admin/chefs";
  return (
    <nav
      aria-label="Admin pages"
      className="mx-auto flex w-full max-w-3xl flex-wrap gap-2 px-4 pt-4"
    >
      <Link
        href="/admin/chefs"
        aria-current={current ? "page" : undefined}
        className={`inline-flex min-h-11 items-center rounded-md border-2 px-4 font-medium ${
          current
            ? "border-emerald-800 bg-emerald-800 text-white underline underline-offset-4"
            : "border-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        }`}
      >
        Chef applications
      </Link>
    </nav>
  );
}
