import type { Metadata } from "next";
import { Suspense } from "react";
import { ChefBookingList } from "@/components/booking/ChefBookingList";
import { requireChefPage } from "@/lib/server/page-guard";

// Chef-only page. The layout guards it, and the page asks again on the server so that in-app
// navigation to it is checked too. The list comes from GET /api/bookings in the browser.
export const metadata: Metadata = {
  title: "Your bookings — CookNeighbour",
  robots: { index: false, follow: false },
};

async function Guarded() {
  await requireChefPage();
  return <ChefBookingList />;
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
