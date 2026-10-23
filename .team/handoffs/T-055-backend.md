# T-055 handoff (backend): deploy pre-flight (WO-7)

No deploy, no Vercel login, no hosted writes. Files: `vercel.json` (new), README "Deploy (Vercel, prototype)" section.

- Env vars (names only): required `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (build time, public), `SUPABASE_SECRET_KEY` and `HASH_PEPPER` (runtime, server only). Never set `NEXT_PUBLIC_API_MOCK`, `SEED_*`.
- Migrations: newest is `20261027100000`; nothing newer.
- `npm audit --omit=dev`: 0 vulnerabilities. `next build` with an empty environment: exit 0 (but CSP then lacks the Supabase host).
- `vercel.json`: `git.deploymentEnabled` `{main: true, "**": false}` from Vercel docs (git-configuration page, 2026-08-25). The `**` plus `main` combination follows the docs' "matches several rules, one true: deploys" and minimatch statements; not tried on a live project. README step 4 tells Jimmy how to confirm.
- Auth: password routes only, no email links or callbacks. Set Site URL and redirect URL anyway; keep "Confirm email" off.
- Builder choices not confirmed by Jimmy: `**` pattern in vercel.json; advice to keep Confirm email off; adding the Smoke list contents.
