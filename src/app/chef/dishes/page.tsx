import type { Metadata } from "next";
import { DishesView } from "@/components/chef/DishesView";

// The chef-only guard for this page is in src/app/chef/layout.tsx.
export const metadata: Metadata = {
  title: "Your dishes — CookNeighbour",
};

export default function Page() {
  return <DishesView />;
}
