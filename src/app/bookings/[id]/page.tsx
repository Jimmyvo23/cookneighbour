import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingFallback } from "@/components/LoadingFallback";
import { BookingDetailView } from "@/components/booking/BookingDetailView";
import { requireCustomerPage } from "@/lib/server/page-guard";

// Customer-only page (server guard first). The booking comes from GET /api/bookings/:id, which
// answers 404 for a booking that is not the caller's own.
export const metadata: Metadata = {
  title: "Booking — CookNeighbour",
  robots: { index: false, follow: false },
};

async function Guarded({
  params,
}: Pick<PageProps<"/bookings/[id]">, "params">) {
  await requireCustomerPage();
  const { id } = await params;
  return <BookingDetailView id={id} />;
}

export default function Page({ params }: PageProps<"/bookings/[id]">) {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Guarded params={params} />
    </Suspense>
  );
}
