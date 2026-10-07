# Handoff: T-056 Env var rename and CI hardening

From: backend  To: tester

## What changed
- Branch: `feature/T-056-env-rename-ci`
- Pull request: see PR for branch (Closes #52, Closes #50)
- Files: `.env.example`, `README.md`, `scripts/db-check.mjs`, `src/lib/supabase/{env,env.test,client}.ts`, `.github/workflows/ci.yml`, this handoff.
- Renamed `NEXT_PUBLIC_SUPABASE_ANON_KEY` to `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to `SUPABASE_SECRET_KEY`.
- env.ts comment: helper is server-only; browser code needs literal `process.env.NEXT_PUBLIC_...`.
- env.test.ts: "never includes a value" test now uses `expect.assertions(2)`.
- CI: `npm run build` after unit tests; `supabase/setup-cli` pinned to 2.120.0 (matches `npm ls supabase`); checkout and setup-node moved to v5. Job id/name still `ci`.

## How to verify
`npm run lint`, `npm run typecheck`, `npx prettier --check .`, `npm test`, `npm run build`, `npm run test:e2e`, `npm run db:check` (3 OK, needs .env.local with new names). `grep -rE "ANON_KEY|SERVICE_ROLE"` finds only historical text in PLAN.md and older handoffs.

## Known gaps or risks
- Old names remain in PLAN.md and T-020/T-021 handoffs as history (not edited).
- CI build uses no Supabase env vars; the current pages do not need them. Revisit when pages read Supabase at build time.
- Vercel or other hosts, if configured, need the new names.

## What the next agent needs
Jimmy's .env.local has both old and new names; old ones can be deleted.
