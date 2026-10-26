import Link from "next/link";
import { FamilyTable } from "@/components/home/FamilyTable";
import { PotMap } from "@/components/home/PotMap";

// T-126 v2 home page. DOM order is words, map, table; the grid places the table above the words on
// wide screens with grid-template-areas, never with CSS `order`, so Tab order is the same at every
// width (T-069 M1). The pots on the map are DEMO data (src/lib/home/demo-pots.ts).
export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      <div className="hero flex flex-1 items-center">
        <section
          className="home-hero mx-auto w-full max-w-6xl px-4"
          aria-label="Welcome"
        >
          <div className="home-copy">
            <span className="mock-badge home-proto">PROTOTYPE</span>
            <h1 className="hero-title home-title">
              Miss your mom&apos;s cooking?
            </h1>
            <p className="home-price">
              A grandma or mom near you cooks the food you grew up with, in your
              kitchen or hers. For less than eating out every day.
            </p>
            <div className="home-actions">
              <Link href="/search" className="btn btn-lg !w-auto">
                Find a home cook
              </Link>
              <Link href="/signup" className="home-love">
                I love to cook
              </Link>
            </div>
          </div>
          <div className="home-map">
            <PotMap />
          </div>
          <div className="home-table">
            <FamilyTable />
          </div>
        </section>
      </div>
    </main>
  );
}
