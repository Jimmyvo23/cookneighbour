import { handle, json } from "@/lib/api/errors";
import { readJsonObject } from "@/lib/api/request";
import {
  checkedUpdate,
  patchApplication,
  requireChef,
  toApplication,
} from "@/lib/server/chef-application";

// GET /api/chef/application: the chef's own application. Repairs missing chefs/chef_private
// rows (interrupted sign-up) inside requireChef().
export function GET() {
  return handle(async () => {
    const chef = await requireChef();
    return json(toApplication(chef.state));
  });
}

// PATCH /api/chef/application: whitelisted profile, kitchen and acknowledgement fields. Applies
// the MOCK re-verification reset (N1) for a changed kitchen address.
export function PATCH(request: Request) {
  return handle(async () => {
    const chef = await requireChef();
    const body = await readJsonObject(request);
    const update = await checkedUpdate(chef, body);
    return json(toApplication(await patchApplication(chef, update)));
  });
}
