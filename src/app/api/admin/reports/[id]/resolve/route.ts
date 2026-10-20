import { handle, json } from "@/lib/api/errors";
import { readJsonObject, requireJson } from "@/lib/api/request";
import { parseDecisionBody } from "@/lib/domain/reviews";
import { validationFailed } from "@/lib/api/errors";
import { requireAdmin } from "@/lib/server/admin-chefs";
import { decide, requireReportExists } from "@/lib/server/admin-engagement";

// POST /api/admin/reports/:id/resolve { finalStatus?, note } (contract 7D, D-54): closes the report.
// An accepted booking gets the final status the admin picks (required then); any other booking
// keeps its status. One locked database function; the free trial follows the status.
export function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    requireJson(request);
    await requireReportExists(admin, id);
    const parsed = parseDecisionBody(await readJsonObject(request), "optional");
    if (!parsed.ok) throw validationFailed(parsed.fields);
    return json(
      await decide(admin, {
        kind: "report_resolve",
        reportId: id,
        bookingId: null,
        finalStatus: parsed.finalStatus,
        note: parsed.note,
      }),
    );
  });
}
