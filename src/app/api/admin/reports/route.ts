import { connection } from "next/server";
import { handle, json } from "@/lib/api/errors";
import { requireAdmin } from "@/lib/server/admin-chefs";
import { listAdminReports } from "@/lib/server/admin-engagement";

// GET /api/admin/reports: problem reports, newest first (contract 7D). Admin only.
export async function GET(request: Request) {
  await connection();
  return handle(async () => {
    const admin = await requireAdmin();
    return json(
      await listAdminReports(admin, new URL(request.url).searchParams),
    );
  });
}
