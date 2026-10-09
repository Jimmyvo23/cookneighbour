import type { Metadata } from "next";
import { Suspense } from "react";
import { ChefReviewView } from "@/components/admin/ChefReviewView";

// The admin-only guard for this page is in src/app/admin/layout.tsx. The page reads nothing on the
// server: the browser loads the application through the guarded /api/admin routes.
export const metadata: Metadata = {
  title: "Review chef application — CookNeighbour admin",
};

async function Review({
  params,
}: Pick<PageProps<"/admin/chefs/[id]">, "params">) {
  const { id } = await params;
  return <ChefReviewView id={id} />;
}

export default function Page({ params }: PageProps<"/admin/chefs/[id]">) {
  return (
    <Suspense
      fallback={
        <p className="p-4" role="status">
          Loading...
        </p>
      }
    >
      <Review params={params} />
    </Suspense>
  );
}
