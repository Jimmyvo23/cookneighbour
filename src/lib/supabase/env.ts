// Reads Supabase settings from environment variables and fails with a clear message if one is missing.
// Variable names are historical ("ANON_KEY", "SERVICE_ROLE_KEY") but the values are Supabase's
// new-style keys: a publishable key (sb_publishable_...) and a secret key (sb_secret_...).
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
  // Property access must be literal so Next.js can inline NEXT_PUBLIC_ values in browser code.
  return {
    url: required(env, "NEXT_PUBLIC_SUPABASE_URL"),
    publishableKey: required(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  };
}

export function getServiceSupabaseEnv(env: Env = process.env) {
  return {
    url: required(env, "NEXT_PUBLIC_SUPABASE_URL"),
    secretKey: required(env, "SUPABASE_SERVICE_ROLE_KEY"),
  };
}
