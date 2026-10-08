// Points the app's env at the LOCAL Supabase stack (public local keys from `supabase status`).
import { vi } from "vitest";
import { localEnv } from "../rls/helpers";
import { getCurrentJar } from "./jar";

const env = localEnv();
process.env.NEXT_PUBLIC_SUPABASE_URL = env.url;
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = env.anon;
process.env.SUPABASE_SECRET_KEY = env.service;
process.env.HASH_PEPPER = "api-test-pepper";

// next/headers only works inside a Next request, so give the routes an in-memory cookie store.
vi.mock("next/headers", () => ({
  cookies: async () => {
    const jar = getCurrentJar();
    return {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      set: (name: string, value: string, options?: { maxAge?: number }) => {
        if (
          value === "" ||
          (options?.maxAge !== undefined && options.maxAge <= 0)
        )
          jar.delete(name);
        else jar.set(name, value);
      },
    };
  },
}));
