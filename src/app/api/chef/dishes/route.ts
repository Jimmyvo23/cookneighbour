import { handle, json } from "@/lib/api/errors";
import { readJsonObject } from "@/lib/api/request";
import type { ChefDishListResponse } from "@/lib/api/types";
import { requireChef } from "@/lib/server/chef-application";
import { createDish, listDishes } from "@/lib/server/dishes";

// GET /api/chef/dishes: the chef's own dishes, active and inactive (contract 5A).
export function GET() {
  return handle(async () => {
    const chef = await requireChef();
    const out: ChefDishListResponse = { items: await listDishes(chef) };
    return json(out);
  });
}

// POST /api/chef/dishes: create a dish (always active). Routes are the only writers (T-032).
export function POST(request: Request) {
  return handle(async () => {
    const chef = await requireChef();
    const body = await readJsonObject(request);
    return json(await createDish(chef, body), 201);
  });
}
