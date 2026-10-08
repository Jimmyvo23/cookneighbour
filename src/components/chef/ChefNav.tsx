"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/chef/apply", label: "Application" },
  { href: "/chef/dishes", label: "Dishes" },
  { href: "/chef/availability", label: "Availability" },
];

/** Navigation between the chef pages. The current page is marked for screen readers and with an
 *  underline, not by colour alone. */
export function ChefNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Chef pages"
      className="mx-auto flex w-full max-w-2xl flex-wrap gap-2 px-4 pt-4"
    >
      {LINKS.map((l) => {
        const current = pathname === l.href;
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={current ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-md border-2 px-4 font-medium ${
              current
                ? "border-emerald-800 bg-emerald-800 text-white underline underline-offset-4"
                : "border-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
