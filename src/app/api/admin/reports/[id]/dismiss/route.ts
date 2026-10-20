import { handle, json, validationFailed } from "@/lib/api/errors";
import { readJsonObject, requireJson } from "@/lib/api/request";
import { parseDecisionBody } from "@/lib/domain/reviews";
import { requireAdmin } from "@/lib/server/admin-chefs";
import { decide, requireReportExists } from "@/lib/server/admin-engagement";

// POST /api/admin/reports/:id/dismiss { note } (contract 7D): closes the report as dismissed and
// never changes the booking, its flags or the free trial.
export function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    requireJson(request);
    await requireReportExists(admin, id);
    const parsed = parseDecisionBody(await readJsonObject(request), "none");
    if (!parsed.ok) throw validationFailed(parsed.fields);
    return json(
      await decide(admin, {
        kind: "report_dismiss",
        reportId: id,
        bookingId: null,
        finalStatus: null,
        note: parsed.note,
      }),
    );
  });
}
