import { handle, json } from "@/lib/api/errors";
import { chefDetail, requireAdmin } from "@/lib/server/admin-chefs";

// GET /api/admin/chefs/:id: one application with 300-second signed links to the private files.
// no-store (json() sets it): the links must never be cached. Nothing here is logged.
export function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    return json(await chefDetail(admin, id));
  });
}
