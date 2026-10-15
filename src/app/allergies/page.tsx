import type { Metadata } from "next";
import { Suspense } from "react";
import { SavedIntakeView } from "@/components/booking/SavedIntakeView";
import { requireCustomerPage } from "@/lib/server/page-guard";

// Customer-only page (server guard first). The saved profile comes from GET /api/me/intake.
export const metadata: Metadata = {
  title: "My allergy profile — CookNeighbour",
  robots: { index: false, follow: false },
};

async function Guarded() {
  await requireCustomerPage();
  return <SavedIntakeView />;
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
