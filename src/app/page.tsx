import Link from "next/link";
import { pageTitle } from "@/lib/app-info";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-4xl sm:text-5xl">{pageTitle()}</h1>
      <p className="max-w-md text-lg text-muted">
        Placeholder home page. Features arrive in later tasks.
      </p>
      <Link href="/search" className="btn">
        Find a home cook
      </Link>
    </main>
  );
}
