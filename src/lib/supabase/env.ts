// Reads Supabase settings from environment variables and fails with a clear message if one is missing.
// Values are Supabase's new-style keys: a publishable key (sb_publishable_...) and a secret key (sb_secret_...).
// The error messages name the variable only, never its value.

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in (see README, Supabase setup).`,
    );
  }
  return value;
}

export function getPublicSupabaseEnv(env: Env = process.env) {
  // For server code only. Browser code must read literal `process.env.NEXT_PUBLIC_...` so Next.js
  // can inline the values at build time (see client.ts); a dynamic env[name] lookup is empty there.
  return {
    url: required(env, "NEXT_PUBLIC_SUPABASE_URL"),
    publishableKey: required(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  };
}

export function getServiceSupabaseEnv(env: Env = process.env) {
  return {
    url: required(env, "NEXT_PUBLIC_SUPABASE_URL"),
    secretKey: required(env, "SUPABASE_SECRET_KEY"),
  };
}
