import { connection } from "next/server";
import { handle, json } from "@/lib/api/errors";
import { requireAdmin } from "@/lib/server/admin-chefs";
import { listAdminReviews } from "@/lib/server/admin-engagement";

// GET /api/admin/reviews: all reviews, including a chef's reviews of customers (contract 7D).
export async function GET(request: Request) {
  await connection();
  return handle(async () => {
    const admin = await requireAdmin();
    return json(
      await listAdminReviews(admin, new URL(request.url).searchParams),
    );
  });
}
