import type { Metadata } from "next";
import Link from "next/link";

// PLACEHOLDER (T-040). The public chef page is built in T-041 and replaces this file. It exists so
// the links in the search results do not lead to a 404 in the meantime.
export const metadata: Metadata = {
  title: "Chef — CookNeighbour",
};

export default function Page() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Chef page</h1>
      <p>The chef page is coming soon.</p>
      <p>
        <Link
          href="/search"
          className="font-medium text-emerald-800 underline dark:text-emerald-300"
        >
          Back to the search
        </Link>
      </p>
    </main>
  );
}
