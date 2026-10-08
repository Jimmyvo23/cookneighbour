// Next.js 16 proxy (formerly middleware): refreshes the Supabase session on every page request so
// Server Components always see a valid cookie. Forwards the cookies AND the cache headers that
// @supabase/ssr passes to setAll (so a refreshed session is never cached by a CDN).
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";

export async function proxy(request: NextRequest) {
  let env: ReturnType<typeof getPublicSupabaseEnv>;
  try {
    env = getPublicSupabaseEnv();
  } catch {
    return NextResponse.next(); // Supabase not configured (for example a bare smoke-test run)
  }
  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });
  try {
    await supabase.auth.getUser(); // validates and refreshes the token
  } catch {
    // Never block a page because the refresh failed.
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
