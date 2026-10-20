import { connection } from "next/server";
import { handle, json } from "@/lib/api/errors";
import { requireAdmin } from "@/lib/server/admin-chefs";
import { listAdminMessages } from "@/lib/server/admin-engagement";

// GET /api/admin/bookings/:id/messages: the chat of any booking, read only, oldest first
// (contract 7D, T-046 choice 10). The admin never sends: the 7C routes stay 403 for the admin.
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await connection();
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    return json(
      await listAdminMessages(admin, id, new URL(request.url).searchParams),
    );
  });
}
