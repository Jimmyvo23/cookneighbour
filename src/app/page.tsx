import Link from "next/link";
import { HeroArt } from "@/components/Ornaments";
import { pageTitle } from "@/lib/app-info";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      <div className="hero flex flex-1 items-center !pb-20">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-6 px-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="flex flex-col items-start gap-5">
            <h1 className="hero-title text-4xl sm:text-6xl">
              {pageTitle()}
              <span className="title-rule" aria-hidden="true" />
            </h1>
            <p className="hero-tagline max-w-xl">
              Home-cooked food from your own culture, made by a neighbour.
            </p>
            <Link href="/search" className="btn-gold btn-lg !w-auto">
              Find a home cook
            </Link>
          </div>
          <HeroArt className="hero-art mx-auto w-full max-w-xs sm:max-w-md" />
        </div>
      </div>
    </main>
  );
}
