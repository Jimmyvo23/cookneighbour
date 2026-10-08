import { handle, json } from "@/lib/api/errors";
import { requireJson } from "@/lib/api/request";
import type { AdminChefActionResponse } from "@/lib/api/types";
import {
  approveChef,
  requireAdmin,
  requireChefExists,
} from "@/lib/server/admin-chefs";

// POST /api/admin/chefs/:id/approve: pending -> approved in one database transaction. The body is
// ignored but the request must still say it is application/json (CSRF rule). MOCK checks.
export function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const admin = await requireAdmin();
    requireJson(request);
    const { id } = await ctx.params;
    await requireChefExists(admin, id);
    const out: AdminChefActionResponse = {
      application: await approveChef(admin, id),
    };
    return json(out);
  });
}
