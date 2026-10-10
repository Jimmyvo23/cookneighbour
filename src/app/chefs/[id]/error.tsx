"use client";
// Last-resort boundary for the public chef page: an unexpected render error shows a plain message
// with a retry instead of a blank screen.
export default function ChefError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 px-4 py-8">
      <div role="alert" className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          The chef page did not load
        </h1>
        <p>Something went wrong. Please try again.</p>
        <p>
          <button
            type="button"
            onClick={() => reset()}
            className="min-h-11 rounded-md border-2 border-emerald-800 px-4 font-semibold text-emerald-900 hover:bg-emerald-50 dark:text-emerald-200 dark:hover:bg-emerald-950"
          >
            Try again
          </button>
        </p>
      </div>
    </main>
  );
}
