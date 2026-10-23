"use client";
import { EmptyPlate } from "@/components/Ornaments";

// Last-resort boundary for any page: a plain message and a retry instead of a blank screen.
export default function AppError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-start gap-5 px-4 py-10">
      <EmptyPlate className="size-36" />
      <div role="alert" className="flex flex-col items-start gap-4">
        <h1>Something went wrong</h1>
        <p className="max-w-prose text-lg">Please try again.</p>
        <button type="button" onClick={() => reset()} className="btn-secondary">
          Try again
        </button>
      </div>
    </main>
  );
}
