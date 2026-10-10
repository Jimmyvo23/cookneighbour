import { connection } from "next/server";
import { handle, json } from "@/lib/api/errors";
import { getChefDetail } from "@/lib/server/search";

// GET /api/chefs/:id: public chef page data (contract section 7). One 404 for every hidden chef.
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await connection();
  return handle(async () => json(await getChefDetail((await ctx.params).id)));
}
