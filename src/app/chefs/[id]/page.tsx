import type { Metadata } from "next";
import { Suspense } from "react";
import { ChefDetailView } from "@/components/chefs/ChefDetailView";

// Public page: anyone may open it, signed in or not. It reads nothing on the server; the browser
// calls the public route GET /api/chefs/:id (docs/api-contract.md section 7), which answers one
// identical 404 for every chef who must not be shown.
export const metadata: Metadata = {
  title: "Chef — CookNeighbour",
};

async function Chef({ params }: Pick<PageProps<"/chefs/[id]">, "params">) {
  const { id } = await params;
  return <ChefDetailView id={id} />;
}

export default function Page({ params }: PageProps<"/chefs/[id]">) {
  return (
    <Suspense
      fallback={
        <p className="p-4" role="status">
          Loading...
        </p>
      }
    >
      <Chef params={params} />
    </Suspense>
  );
}
