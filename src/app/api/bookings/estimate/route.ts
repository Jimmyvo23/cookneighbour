import { handle, json } from "@/lib/api/errors";
import { readJsonObject } from "@/lib/api/request";
import { estimateRequest, requireCustomer } from "@/lib/server/bookings";

// POST /api/bookings/estimate: the price and time estimate plus every rule problem found, without
// creating anything (contract 7A). Customers only. MOCK: no money moves.
export function POST(request: Request) {
  return handle(async () => {
    const caller = await requireCustomer();
    const body = await readJsonObject(request);
    return json(await estimateRequest(caller, body));
  });
}
