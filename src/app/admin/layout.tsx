import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminNav } from "@/components/admin/AdminNav";
import { requireAdminPage } from "@/lib/server/page-guard";

// The admin-only guard runs here, on the server, before any child is rendered or sent (fail
// closed: a visitor, customer or chef is redirected, and an unexpected error is thrown rather than
// showing the page). Limits: a layout does not run again on in-app navigation, so this only
// protects pages that load their private data in the browser through guarded API routes (every
// /api/admin route checks the admin role itself), as every page under /admin does today. A page
// that reads private data on the server must call requireAdminPage() itself.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

async function Guarded({ children }: { children: React.ReactNode }) {
  await requireAdminPage();
  return (
    <>
      <AdminNav />
      {children}
    </>
  );
}

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
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
