import type { Metadata } from "next";
import { ChefQueueView } from "@/components/admin/ChefQueueView";

// The admin-only guard for this page is in src/app/admin/layout.tsx.
export const metadata: Metadata = {
  title: "Chef applications — CookNeighbour admin",
};

export default function Page() {
  return <ChefQueueView />;
}
