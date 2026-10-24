import Link from "next/link";
import { EmptyPlate } from "@/components/Ornaments";

// The 404 page: a plain message and a way back, with the empty plate.
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-start gap-5 px-4 py-10">
      <EmptyPlate className="size-36" />
      <h1>This page could not be found</h1>
      <p className="max-w-prose text-lg">
        The link may be wrong, or the page has moved.
      </p>
      <Link href="/search" className="btn">
        Find a home cook
      </Link>
    </main>
  );
}
