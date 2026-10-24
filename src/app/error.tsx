"use client";
import { useEffect, useRef } from "react";
import { EmptyPlate } from "@/components/Ornaments";

// Last-resort boundary for any page: a plain message and a retry instead of a blank screen.
// Focus moves to the message when it appears (lessons-learned section 3).
export default function AppError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-start gap-5 px-4 py-10">
      <EmptyPlate className="size-36" />
      <div
        ref={ref}
        tabIndex={-1}
        role="alert"
        className="flex flex-col items-start gap-4 outline-offset-4"
      >
        <h1>Something went wrong</h1>
        <p className="max-w-prose text-lg">Please try again.</p>
        <button type="button" onClick={() => reset()} className="btn-secondary">
          Try again
        </button>
      </div>
    </main>
  );
}
