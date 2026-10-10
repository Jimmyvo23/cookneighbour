import { connection } from "next/server";
import { handle, json } from "@/lib/api/errors";
import { parseListQuery } from "@/lib/domain/admin-chefs";
import { listChefs, requireAdmin } from "@/lib/server/admin-chefs";

// GET /api/admin/chefs: the chef queue (contract section 6). Admin only; newest first.
export async function GET(request: Request) {
  // Request-time data (cookies): keeps this route out of the build-time prerender (T-036 finding).
  await connection();
  return handle(async () => {
    const admin = await requireAdmin();
    const query = parseListQuery(new URL(request.url).searchParams);
    return json(await listChefs(admin, query));
  });
}
