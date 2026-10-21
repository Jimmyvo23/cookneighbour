"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const PAGES = [
  { href: "/admin/chefs", label: "Chef applications" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/reports", label: "Problem reports" },
  { href: "/admin/free-trial-blocks", label: "Free-trial blocks" },
];

/** Navigation between the admin pages. The current page is marked for screen readers and with an
 *  underline, not by colour alone. A page below a section (a chef, a booking chat) keeps its
 *  section marked. */
export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Admin pages"
      className="mx-auto flex w-full max-w-3xl flex-wrap gap-2 px-4 pt-4"
    >
      {PAGES.map((p) => {
        const current =
          pathname === p.href || pathname.startsWith(`${p.href}/`);
        return (
          <Link
            key={p.href}
            href={p.href}
            aria-current={current ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-md border-2 px-4 font-medium ${
              current
                ? "border-emerald-800 bg-emerald-800 text-white underline underline-offset-4"
                : "border-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}
