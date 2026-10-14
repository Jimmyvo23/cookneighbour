import type { Metadata } from "next";
import { Suspense } from "react";
import { BookingList } from "@/components/booking/BookingList";
import { requireCustomerPage } from "@/lib/server/page-guard";

// Customer-only page (server guard first). The list comes from GET /api/bookings in the browser.
export const metadata: Metadata = {
  title: "My bookings — CookNeighbour",
  robots: { index: false, follow: false },
};

async function Guarded() {
  await requireCustomerPage();
  return <BookingList />;
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
