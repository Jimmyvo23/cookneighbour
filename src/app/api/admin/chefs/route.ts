import { handle, json } from "@/lib/api/errors";
import { parseListQuery } from "@/lib/domain/admin-chefs";
import { listChefs, requireAdmin } from "@/lib/server/admin-chefs";

// GET /api/admin/chefs: the chef queue (contract section 6). Admin only; newest first.
export function GET(request: Request) {
  return handle(async () => {
    const admin = await requireAdmin();
    const query = parseListQuery(new URL(request.url).searchParams);
    return json(await listChefs(admin, query));
  });
}
