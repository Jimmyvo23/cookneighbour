# Handoff: T-055 Deploy pre-flight (Tester)

From: tester  To: reviewer

## What changed
- Branch: `feature/T-055-deploy-preflight` (head 6122053), PR #222. No application or test code changed; no coverage added (docs and config only).
- Files verified: `vercel.json`, `README.md` (Deploy section), `.team/handoffs/T-055-backend.md`.

## How to verify (what I ran)
- Env audit: grep of every `process.env` in src/, scripts/, next.config.ts, src/proxy.ts. Names read: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, HASH_PEPPER, VERCEL, NODE_ENV, NEXT_PUBLIC_API_MOCK, SEED_ADMIN_PASSWORD, SEED_DEMO_*; nothing missing from the README table. Secrets are not NEXT_PUBLIC_.
- Mock switch: `src/lib/api/client.ts:6` is `process.env.NEXT_PUBLIC_API_MOCK === "1"`. Only exactly "1" enables it; "0", "false", "true", blank, unset do not.
- `next build` with `env -i` (empty env): succeeds; CSP `connect-src 'self'` only. With a dummy URL + publishable key: succeeds; CSP gains `https://<host>` and `wss://<host>`; both values inlined in `.next/static`. Neither HASH_PEPPER nor SUPABASE_SECRET_KEY appears in `.next/static`.
- vercel.json: valid JSON; the Vercel schema (https://openapi.vercel.sh/vercel.json) defines `git.deploymentEnabled` as boolean or object of booleans, which this matches (full Ajv compile not possible, schema uses draft-04 ref). minimatch 3.1.5: `**` matches `main`, `feature/T-055-x`, `dev/x/y`; `main` matches only `main`. Vercel doc (git-configuration, fetched today): "If a branch matches multiple rules and at least one rule is true, a deployment will occur." So main (true + true) deploys.
- `npm run lint` clean; prettier clean on README.md, vercel.json, handoff. `gh pr checks 222`: checks, ci, e2e-mock, supabase all pass. Migrations: newest `20261027100000` (confirmed). PR is BEHIND main (merge state), touches no file main changed after the base; update branch if the Planner wants.

## Known gaps or risks
- Not verified: live Vercel behaviour (no deploy allowed); Vercel's minimatch version/options for `**` with slashes (only minimatch 3 tested).
- See findings in the report (below / chat).

## Findings
- MED: README.md step 6 does not say `.env.local` must hold the HOSTED `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` for `npm run db:seed -- --hosted` (scripts/seed.ts:374-379 reads them from the environment, and `db:check` needs the publishable key too). Following the step literally with a local-stack `.env.local` seeds the wrong database or fails. Add one line.
- LOW: Table says HASH_PEPPER should be "a new value, not your local one"; step 6 says `.env.local` must carry the Vercel value. Reads as a contradiction. Say "put the same new value in `.env.local` while seeding hosted, then restore your local value".
- LOW: step 6 lists SEED_ADMIN_PASSWORD without "optional", and the smoke test needs the seeded admin; clarify that without it no admin exists (seed.ts:387, 178).
- LOW: smoke test says "log in as the seeded customer/admin" but gives no emails; point to where they are in the seed docs.
- NIT: "Only the two NEXT_PUBLIC_ names are in the browser bundle" omits NEXT_PUBLIC_API_MOCK (inlined as empty/unset; harmless).
- NIT: README step 5 "Redirect URLs = the same URL" then adds `/**`; fine, wording only.

## What the next agent needs
Verdict PASS with the MED doc fix recommended before merge (one README line).
