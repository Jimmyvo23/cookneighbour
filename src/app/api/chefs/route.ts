import { connection } from "next/server";
import { handle, json } from "@/lib/api/errors";
import { searchChefs } from "@/lib/server/search";

// GET /api/chefs: public search (contract section 7). No auth; filters, distance sort, paging.
export async function GET(request: Request) {
  await connection();
  return handle(async () =>
    json(await searchChefs(new URL(request.url).searchParams)),
  );
}
