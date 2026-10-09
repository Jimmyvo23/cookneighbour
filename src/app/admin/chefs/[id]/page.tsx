import type { Metadata } from "next";
import { ChefReviewView } from "@/components/admin/ChefReviewView";

// The admin-only guard for this page is in src/app/admin/layout.tsx. The page reads nothing on the
// server: the browser loads the application through the guarded /api/admin routes.
export const metadata: Metadata = {
  title: "Review chef application — CookNeighbour admin",
};

export default async function Page({ params }: PageProps<"/admin/chefs/[id]">) {
  const { id } = await params;
  return <ChefReviewView id={id} />;
}
