// Browser Supabase client. Uses only the publishable key; row-level security protects the data.
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  // Literal property access so Next.js inlines the NEXT_PUBLIC_ values into the browser bundle.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. See README, Supabase setup.",
    );
  }
  return createBrowserClient(url, key);
}
