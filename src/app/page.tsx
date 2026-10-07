import { pageTitle } from "@/lib/app-info";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
        {pageTitle()}
      </h1>
      <p className="max-w-md text-base text-zinc-600 dark:text-zinc-400">
        Placeholder home page. Features arrive in later tasks.
      </p>
    </main>
  );
}
