import type { Metadata } from "next";
import { SearchView } from "@/components/search/SearchView";

// Public page: anyone may search, signed in or not. It reads nothing on the server; the browser
// calls the public search routes (docs/api-contract.md section 7).
export const metadata: Metadata = {
  title: "Find a home cook — CookNeighbour",
  description:
    "Search approved home cooks near you by cuisine, language, price and day.",
};

export default function Page() {
  return <SearchView />;
}
