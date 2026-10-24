import Link from "next/link";
import { HeroStage } from "@/components/hero/HeroStage";
import { MockBadge } from "@/components/MockBadge";

// T-126: the headline is the promise (words approved by Jimmy). The document title stays
// "CookNeighbour — prototype" (src/lib/app-info.ts, src/app/layout.tsx).
export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      <HeroStage>
        <div className="flex flex-col items-start gap-5">
          <MockBadge>Prototype · nothing is real or charged</MockBadge>
          <h1 className="hero-title text-4xl sm:text-6xl">
            A home cook from your culture, in your kitchen or theirs.
            <span className="title-rule" aria-hidden="true" />
          </h1>
          <p className="hero-tagline max-w-xl">
            Home-cooked food from your own culture, made by a neighbour.
          </p>
          <div className="flex flex-wrap items-center gap-x-7 gap-y-3 self-stretch">
            <Link href="/search" className="btn-gold btn-lg !w-auto">
              Find a home cook
            </Link>
            <Link href="/signup" className="hero-cook-link">
              I&apos;m a home cook &rarr;
            </Link>
          </div>
        </div>
      </HeroStage>
    </main>
  );
}
