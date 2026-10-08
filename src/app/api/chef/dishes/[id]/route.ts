import { handle, json } from "@/lib/api/errors";
import { readJsonObject } from "@/lib/api/request";
import { requireChef } from "@/lib/server/chef-application";
import { updateDish } from "@/lib/server/dishes";

// PATCH /api/chef/dishes/:id: edit, deactivate (`isActive: false`) or reactivate a dish. There is
// no DELETE: nothing is deleted (contract 5A). A dish that is not the caller's is a 404.
export function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const chef = await requireChef();
    const body = await readJsonObject(request);
    const { id } = await ctx.params;
    return json(await updateDish(chef, id, body));
  });
}
