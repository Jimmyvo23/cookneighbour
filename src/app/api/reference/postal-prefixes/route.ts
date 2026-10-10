import { connection } from "next/server";
import { handle, json } from "@/lib/api/errors";
import { listPostalPrefixes } from "@/lib/server/search";

// GET /api/reference/postal-prefixes: GTA areas and centres for the city picker (contract 7).
// The same for everyone, so it is cacheable. connection() keeps it out of the build-time
// prerender, which would freeze the table into the build.
export async function GET() {
  await connection();
  const res = await handle(async () => json(await listPostalPrefixes()));
  if (res.ok)
    res.headers.set(
      "Cache-Control",
      "public, max-age=3600, stale-while-revalidate=86400",
    );
  return res;
}
