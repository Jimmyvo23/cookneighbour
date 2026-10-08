import { handle, json } from "@/lib/api/errors";
import {
  readJsonObject,
  rejectUnknownKeys,
  requireJson,
} from "@/lib/api/request";
import type { AdminChefActionResponse } from "@/lib/api/types";
import { CHECKS_KEYS, parseChecksBody } from "@/lib/domain/admin-chefs";
import {
  requireAdmin,
  requireChefExists,
  setChecks,
} from "@/lib/server/admin-chefs";

// PATCH /api/admin/chefs/:id/checks: record MOCK ID, food-handler and police outcomes. A check
// names the file the admin viewed; the write only happens if that file is still the stored one.
export function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    requireJson(request);
    await requireChefExists(admin, id);
    const body = await readJsonObject(request);
    rejectUnknownKeys(body, [...CHECKS_KEYS]);
    const checks = parseChecksBody(body);
    const out: AdminChefActionResponse = {
      application: await setChecks(admin, id, checks),
    };
    return json(out);
  });
}
