import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingFallback } from "@/components/LoadingFallback";
import { ChefBookingView } from "@/components/booking/ChefBookingView";
import { requireChefPage } from "@/lib/server/page-guard";

// Chef-only page (server guard in the layout and again here). The booking comes from
// GET /api/bookings/:id, which answers 404 for a booking that is not the caller's own.
export const metadata: Metadata = {
  title: "Booking — CookNeighbour",
  robots: { index: false, follow: false },
};

async function Guarded({
  params,
}: Pick<PageProps<"/chef/bookings/[id]">, "params">) {
  await requireChefPage();
  const { id } = await params;
  return <ChefBookingView id={id} />;
}

export default function Page({ params }: PageProps<"/chef/bookings/[id]">) {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Guarded params={params} />
    </Suspense>
  );
}
