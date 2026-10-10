"use client";
// Loads the Leaflet map in the browser only (Leaflet needs `window`), after the page is usable.
import dynamic from "next/dynamic";

export const ResultsMap = dynamic(() => import("./ChefMap"), {
  ssr: false,
  loading: () => (
    <p role="status" className="rounded-lg border border-zinc-400 p-4 text-sm">
      Loading the map...
    </p>
  ),
});
