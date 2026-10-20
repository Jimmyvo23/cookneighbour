import { connection } from "next/server";
import { handle, json } from "@/lib/api/errors";
import { requireAdmin } from "@/lib/server/admin-chefs";
import { listAdminBookings } from "@/lib/server/admin-engagement";

// GET /api/admin/bookings: every booking, newest first, with its open flag and open report count
// (contract 7D). Admin only.
export async function GET(request: Request) {
  await connection();
  return handle(async () => {
    const admin = await requireAdmin();
    return json(
      await listAdminBookings(admin, new URL(request.url).searchParams),
    );
  });
}
