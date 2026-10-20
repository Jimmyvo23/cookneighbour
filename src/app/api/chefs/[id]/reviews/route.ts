import { connection } from "next/server";
import { handle, json } from "@/lib/api/errors";
import { listPublicReviews } from "@/lib/server/reviews";

// GET /api/chefs/:id/reviews: customers' reviews of a chef, newest first (contract 7D). Public.
// One 404 for every chef the public must not see, the same as GET /api/chefs/:id.
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await connection();
  return handle(async () => {
    const { id } = await ctx.params;
    return json(await listPublicReviews(id, new URL(request.url).searchParams));
  });
}
