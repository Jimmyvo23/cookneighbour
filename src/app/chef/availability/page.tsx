import type { Metadata } from "next";
import { AvailabilityView } from "@/components/chef/AvailabilityView";

// The chef-only guard for this page is in src/app/chef/layout.tsx.
export const metadata: Metadata = {
  title: "Your availability — CookNeighbour",
};

export default function Page() {
  return <AvailabilityView />;
}
