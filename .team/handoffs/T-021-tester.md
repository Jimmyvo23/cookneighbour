# Handoff: T-021 Supabase setup (Tester)

From: tester  To: reviewer

Verdict: PASS (with one note for Jimmy, below)

## Results (fresh clone of feature/T-021-supabase-setup at 64484e6, no .env.local)
- npm ci: OK. lint: exit 0. typecheck: exit 0. test: 6/6 pass. build: OK. test:e2e: 1/1 pass.
- npm audit --omit=dev: 0 vulnerabilities.
- prettier --check .: only PLAN.md warns. PLAN.md is unchanged by this branch (same as main), so this is pre-existing, not caused by T-021.
- db:check in fresh clone: prints "FAIL missing variables: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY", exit 1, no stack trace, no values.
- db:check in main folder (Jimmy's .env.local, never read by me): OK project reachable, OK publishable key accepted, OK secret key accepted, "db:check OK", exit 0. (Backend's handoff reported a rejected publishable key; Jimmy has evidently fixed it.)
- .env.example: all three variable values empty.
- admin.ts and server.ts both import "server-only". No file under src has "use client"; nothing imports admin.ts; client.ts imports only @supabase/ssr.
- After build, .next/static has no SUPABASE_SERVICE_ROLE_KEY, service_role or sb_secret strings (0 files).
- No tables or migrations: supabase/ holds only config.toml and .gitignore; diff is 13 files, none are migrations.

## Not tested
- Negative build check (client file importing admin.ts) not run; I may not edit app code.
- Clients not exercised against live auth/DB flows (none exist yet). server-only not covered by Vitest by design.

## Note
- Variable names still say ANON_KEY / SERVICE_ROLE_KEY while holding new-style keys; backend suggested a rename (Planner/Jimmy decision).
