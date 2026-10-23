import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingFallback } from "@/components/LoadingFallback";
import { BookingFlow } from "@/components/booking/BookingFlow";
import { requireCustomerPage } from "@/lib/server/page-guard";

// Customer-only page. The guard runs here, on the server, before any of the form is sent (fail
// closed: a visitor goes to /login, a chef or admin goes home). The page loads the chef from the
// public route and sends the request through POST /api/bookings, which checks everything again.
export const metadata: Metadata = {
  title: "Book a chef — CookNeighbour",
  robots: { index: false, follow: false },
};

async function Guarded({
  params,
}: Pick<PageProps<"/chefs/[id]/book">, "params">) {
  await requireCustomerPage();
  const { id } = await params;
  return <BookingFlow chefId={id} />;
}

export default function Page({ params }: PageProps<"/chefs/[id]/book">) {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Guarded params={params} />
    </Suspense>
  );
}
