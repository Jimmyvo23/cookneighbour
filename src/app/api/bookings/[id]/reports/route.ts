import { connection } from "next/server";
import { handle, json } from "@/lib/api/errors";
import { readJsonObject, requireJson } from "@/lib/api/request";
import { requireBookingParty } from "@/lib/server/bookings";
import { createReport, listOwnReports } from "@/lib/server/reports";

// GET /api/bookings/:id/reports: only the caller's own reports on this booking (contract 7D).
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await connection();
  return handle(async () => {
    const caller = await requireBookingParty();
    const { id } = await ctx.params;
    return json(await listOwnReports(caller, id));
  });
}

// POST /api/bookings/:id/reports { clientId, category?, description }: report a problem. Either
// party, any booking status. 201, or 200 for a retry with the same clientId and content. The other
// party is never told.
export function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const caller = await requireBookingParty();
    requireJson(request);
    const { id } = await ctx.params;
    const out = await createReport(caller, id, () => readJsonObject(request));
    return json(out.report, out.duplicate ? 200 : 201);
  });
}
