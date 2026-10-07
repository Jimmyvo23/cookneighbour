# Handoff: T-021 Supabase setup

From: backend  To: tester

## What changed
- Branch: `feature/T-021-supabase-setup`
- Pull request: see PR for branch (Closes #9)
- Files: `supabase/config.toml` (from `supabase init`), `src/lib/supabase/{env,client,server,admin}.ts`, `src/lib/supabase/env.test.ts`, `scripts/db-check.mjs`, `.env.example`, `README.md`, `package.json` (+ lock: `@supabase/supabase-js`, `@supabase/ssr`, `server-only`, dev `supabase` CLI, script `db:check`).
- No tables or migrations (WO-2).

## How to verify
- `npm run lint`, `npm run typecheck`, `npm test` (6 tests), `npm run build`, `npm run test:e2e`: all pass.
- `npm run db:check` (needs Jimmy's `.env.local`; prints only OK/FAIL). Without the file it prints "FAIL missing variables: ..." and exits 1.
- Confirm `admin.ts` and `server.ts` import `server-only`; confirm no key values in the diff (`git diff main --stat`, grep for `sb_`).
- Optional negative check: import `admin.ts` from a `"use client"` file; the build should fail.

## Known gaps or risks
- db:check result on Jimmy's `.env.local`: server reachable OK, secret key accepted OK, **publishable key REJECTED** (HTTP 401 on `/auth/v1/health`, `/auth/v1/settings`, `/rest/v1/`). Possibly a mistyped/stale/swapped publishable key value in `.env.local`. I did not inspect the value. Jimmy should re-copy it from Project Settings > API Keys. The browser and server clients depend on it.
- Browser/server clients are untested against the live project (no auth flow yet).
- `server-only` is not exercised by Vitest (it throws outside the Next bundler by design).
- `supabase init` generated a default config.toml; unreviewed beyond defaults. Local `supabase start` not run (no Docker).

## What the next agent needs
- Variable names kept as-is. Suggestion for Jimmy/Planner: rename to `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` to match the new key style (touches `env.ts`, `client.ts`, `db-check.mjs`, `.env.example`, README, and Jimmy's `.env.local`).
- Cache Components: `server.ts` calls `cookies()` per request via `await createClient()`. Use it inside `<Suspense>`, Route Handlers or Server Functions; never at module level or inside `"use cache"`. Session refresh in Server Components cannot write cookies (the setAll error is swallowed); a proxy or Server Function must refresh sessions in the auth task.
- `createAdminClient()` bypasses row-level security; use only for trusted server work.
