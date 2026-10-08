import { handle, json } from "@/lib/api/errors";
import {
  readJsonObject,
  rejectUnknownKeys,
  requireJson,
} from "@/lib/api/request";
import type { AdminChefActionResponse } from "@/lib/api/types";
import {
  KITCHEN_REVIEW_KEYS,
  parseKitchenReview,
} from "@/lib/domain/admin-chefs";
import {
  requireAdmin,
  requireChefExists,
  reviewKitchen,
} from "@/lib/server/admin-chefs";

// POST /api/admin/chefs/:id/kitchen-review: MOCK review of the chef's kitchen. The admin names the
// photos and address they viewed; the decision is saved only if they are still the stored ones.
export function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    requireJson(request);
    await requireChefExists(admin, id);
    const body = await readJsonObject(request);
    rejectUnknownKeys(body, [...KITCHEN_REVIEW_KEYS]);
    const review = parseKitchenReview(body);
    const out: AdminChefActionResponse = {
      application: await reviewKitchen(admin, id, review),
    };
    return json(out);
  });
}
