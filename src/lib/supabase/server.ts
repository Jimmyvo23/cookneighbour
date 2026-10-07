import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicSupabaseEnv } from "./env";

// Server Supabase client for Server Components, Server Functions and Route Handlers.
// It acts as the signed-in user (publishable key + session cookie), so row-level security applies.
//
// Cache Components note (next.config.ts enables cacheComponents): cookies() is a request-time API.
// - Create the client inside the request, per call. Never at module level and never inside "use cache".
// - Call it from code rendered inside a <Suspense> boundary (or a Route Handler / Server Function),
//   otherwise the route cannot be prerendered.
export async function createClient() {
  const { url, publishableKey } = getPublicSupabaseEnv();
  const cookieStore = await cookies();
  return createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component, where cookies are read-only. Safe to ignore:
          // session refresh happens in a Route Handler, Server Function or proxy instead.
        }
      },
    },
  });
}
