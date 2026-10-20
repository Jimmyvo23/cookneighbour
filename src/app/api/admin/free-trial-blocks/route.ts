import { connection } from "next/server";
import { handle, json } from "@/lib/api/errors";
import { requireAdmin } from "@/lib/server/admin-chefs";
import { listAdminFreeTrialBlocks } from "@/lib/server/admin-engagement";

// GET /api/admin/free-trial-blocks: blocked second free-trial attempts with the real reason
// (contract 7D). Admin only; customers never learn the reason.
export async function GET(request: Request) {
  await connection();
  return handle(async () => {
    const admin = await requireAdmin();
    return json(
      await listAdminFreeTrialBlocks(admin, new URL(request.url).searchParams),
    );
  });
}
