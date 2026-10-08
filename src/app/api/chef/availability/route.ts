import { handle, json } from "@/lib/api/errors";
import { readJsonObject } from "@/lib/api/request";
import { requireChef } from "@/lib/server/chef-application";
import { readAvailability, setAvailability } from "@/lib/server/dishes";

// GET /api/chef/availability: the chef's available dates from today on (contract 5B).
export function GET() {
  return handle(async () => json(await readAvailability(await requireChef())));
}

// PUT /api/chef/availability: { add?, remove? } dates. Routes are the only writers (T-032).
export function PUT(request: Request) {
  return handle(async () => {
    const chef = await requireChef();
    const body = await readJsonObject(request);
    return json(await setAvailability(chef, body));
  });
}
