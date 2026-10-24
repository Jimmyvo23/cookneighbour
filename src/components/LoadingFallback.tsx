import { PotMark } from "@/components/Ornaments";

/** The Suspense fallback of guarded pages: a pot that steams while the page guard answers.
 *  The text stays exactly "Loading..." (the tests and screen readers look for it). */
export function LoadingFallback() {
  return (
    <p
      role="status"
      className="mx-auto flex w-full max-w-3xl items-center gap-3 p-6 font-display text-xl font-bold"
    >
      <PotMark className="size-12" />
      Loading...
    </p>
  );
}
