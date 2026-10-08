import type { Metadata } from "next";
import { Suspense } from "react";
import { ChefNav } from "@/components/chef/ChefNav";
import { requireChefPage } from "@/lib/server/page-guard";

// Every page under /chef shows private data, so the chef-only guard lives here, on the server, and
// runs before any child is rendered or sent (fail closed: a visitor, customer or admin is
// redirected, and an unexpected error is thrown rather than showing the page). Pages under /chef
// therefore need no guard of their own.
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
