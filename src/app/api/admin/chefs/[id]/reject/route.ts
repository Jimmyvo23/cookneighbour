import { handle, json } from "@/lib/api/errors";
import {
  readJsonObject,
  rejectUnknownKeys,
  requireJson,
} from "@/lib/api/request";
import type { AdminChefActionResponse } from "@/lib/api/types";
import { REJECT_KEYS, parseReason } from "@/lib/domain/admin-chefs";
import {
  rejectChef,
  requireAdmin,
  requireChefExists,
} from "@/lib/server/admin-chefs";

// POST /api/admin/chefs/:id/reject { reason }: pending or approved -> rejected, reason shown to
// the chef. Unknown chef is 404 before the body is checked.
export function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    // Content type first (400), then the chef (404), then the body (400/422).
    requireJson(request);
    await requireChefExists(admin, id);
    const body = await readJsonObject(request);
    rejectUnknownKeys(body, [...REJECT_KEYS]);
    const reason = parseReason(body, "reason");
    const out: AdminChefActionResponse = {
      application: await rejectChef(admin, id, reason),
    };
    return json(out);
  });
}
