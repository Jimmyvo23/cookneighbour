import type { Metadata } from "next";
import { Suspense } from "react";
import { ChefApplicationView } from "@/components/chef/ChefApplicationView";
import { requireChefPage } from "@/lib/server/page-guard";

// Private page: robots keep out, and the chef-only guard runs on the server before any UI is sent.
export const metadata: Metadata = {
  title: "Chef application — CookNeighbour",
  robots: { index: false, follow: false },
};

async function Guarded() {
  await requireChefPage();
  return <ChefApplicationView />;
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <p className="p-4" role="status">
          Loading...
        </p>
      }
    >
      <Guarded />
    </Suspense>
  );
}
