import type { Metadata } from "next";
import { Suspense } from "react";
import { ChefNav } from "@/components/chef/ChefNav";
import { requireChefPage } from "@/lib/server/page-guard";

// The chef-only guard runs here, on the server, before any child is rendered or sent (fail closed:
// a visitor, customer or admin is redirected, and an unexpected error is thrown rather than
// showing the page). Limits: a layout does not run again on in-app navigation, so this only
// protects pages that load their private data in the browser through guarded API routes, as every
// page under /chef does today. A page that reads private data on the server must call
// requireChefPage() itself.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

async function Guarded({ children }: { children: React.ReactNode }) {
  await requireChefPage();
  return (
    <>
      <ChefNav />
      {children}
    </>
  );
}

export default function ChefLayout({ children }: LayoutProps<"/chef">) {
  return (
    <Suspense
      fallback={
        <p className="p-4" role="status">
          Loading...
        </p>
      }
    >
      <Guarded>{children}</Guarded>
    </Suspense>
  );
}
