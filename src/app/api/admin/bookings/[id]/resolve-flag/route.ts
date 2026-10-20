import { handle, json, validationFailed } from "@/lib/api/errors";
import { readJsonObject, requireJson } from "@/lib/api/request";
import { parseDecisionBody } from "@/lib/domain/reviews";
import { requireAdmin } from "@/lib/server/admin-chefs";
import { decide, requireBookingExists } from "@/lib/server/admin-engagement";

// POST /api/admin/bookings/:id/resolve-flag { finalStatus, note } (contract 7D, D-54, D-57, D-67):
// the admin picks the final status of a flagged booking; the flag is resolved and the booking is
// unfrozen. One locked database function; the free trial follows the status.
export function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    requireJson(request);
    await requireBookingExists(admin, id);
    const parsed = parseDecisionBody(await readJsonObject(request), "required");
    if (!parsed.ok) throw validationFailed(parsed.fields);
    return json(
      await decide(admin, {
        kind: "flag_resolve",
        reportId: null,
        bookingId: id,
        finalStatus: parsed.finalStatus,
        note: parsed.note,
      }),
    );
  });
}
