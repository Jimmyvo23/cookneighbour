import { handle, json } from "@/lib/api/errors";
import { requireJson } from "@/lib/api/request";
import type { SubmitApplicationResponse } from "@/lib/api/types";
import {
  requireChef,
  submitApplication,
  toApplication,
} from "@/lib/server/chef-application";

// POST /api/chef/application/submit: send the application for review. The body is ignored but the
// request must still say it is application/json (CSRF rule). MOCK: nothing is verified here; an
// admin records the outcome of each check later.
export function POST(request: Request) {
  return handle(async () => {
    const chef = await requireChef();
    requireJson(request);
    const out: SubmitApplicationResponse = {
      application: toApplication(await submitApplication(chef)),
      mock: true,
    };
    return json(out);
  });
}
