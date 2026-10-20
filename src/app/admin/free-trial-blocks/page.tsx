import type { Metadata } from "next";
import { AdminBlocksView } from "@/components/admin/AdminEngagementViews";

// The admin-only guard for this page is in src/app/admin/layout.tsx.
export const metadata: Metadata = {
  title: "Free-trial blocks — CookNeighbour admin",
};

export default function Page() {
  return <AdminBlocksView />;
}
