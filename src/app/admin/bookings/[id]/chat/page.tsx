import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingFallback } from "@/components/LoadingFallback";
import { AdminChatView } from "@/components/admin/AdminEngagementViews";

// The admin-only guard for this page is in src/app/admin/layout.tsx.
export const metadata: Metadata = {
  title: "Booking chat — CookNeighbour admin",
};

async function Chat({
  params,
}: Pick<PageProps<"/admin/bookings/[id]/chat">, "params">) {
  const { id } = await params;
  return <AdminChatView bookingId={id} />;
}

export default function Page({
  params,
}: PageProps<"/admin/bookings/[id]/chat">) {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Chat params={params} />
    </Suspense>
  );
}
