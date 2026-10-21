import type { Metadata } from "next";
import { AdminReportsView } from "@/components/admin/AdminEngagementViews";

// The admin-only guard for this page is in src/app/admin/layout.tsx.
export const metadata: Metadata = {
  title: "Problem reports — CookNeighbour admin",
};

export default function Page() {
  return <AdminReportsView />;
}
