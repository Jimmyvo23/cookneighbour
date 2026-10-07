// Confirms the hosted Supabase project is reachable. Needs no tables.
// Run: npm run db:check (loads .env.local). Prints only OK / FAIL lines, never key values.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function check(label, fn) {
  try {
    const ok = await fn();
    console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
    return ok;
  } catch {
    console.log(`FAIL ${label} (network error)`);
    return false;
  }
}

const missing = [
  ["NEXT_PUBLIC_SUPABASE_URL", url],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", publishable],
  ["SUPABASE_SERVICE_ROLE_KEY", secret],
]
  .filter(([, v]) => !v?.trim())
  .map(([n]) => n);

if (missing.length) {
  console.log(`FAIL missing variables: ${missing.join(", ")}`);
  process.exit(1);
}

const base = url.trim().replace(/\/+$/, "");
const results = [
  await check("project reachable (server answered)", async () => {
    const r = await fetch(`${base}/auth/v1/health`);
    return r.status < 500;
  }),
  await check("publishable key accepted (auth health)", async () => {
    const r = await fetch(`${base}/auth/v1/health`, {
      headers: { apikey: publishable.trim() },
    });
    return r.ok;
  }),
  await check("secret key accepted (REST root)", async () => {
    const r = await fetch(`${base}/rest/v1/`, {
      headers: {
        apikey: secret.trim(),
        Authorization: `Bearer ${secret.trim()}`,
      },
    });
    return r.ok;
  }),
];
console.log(results.every(Boolean) ? "db:check OK" : "db:check FAILED");
process.exit(results.every(Boolean) ? 0 : 1);
