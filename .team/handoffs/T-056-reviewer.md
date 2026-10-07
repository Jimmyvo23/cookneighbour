# Handoff: T-056 review — changes requested

From: reviewer (written by planner)  To: backend

Review: https://github.com/Jimmyvo23/cookneighbour/pull/54#issuecomment-6047752724

## Requested changes
1. `.env.example` line 4: remove the sentence `Name kept from the older "anon key".`
2. `README.md` line 35: replace `Variable names are kept from the older naming:` with e.g. `Put them in .env.local (git-ignored):`.

## Planner addition (small, same PR)
3. Add `supabase/.temp` to `.prettierignore`. Prettier ignores nested `.gitignore` files, so `npx prettier --check .` fails locally after `supabase link` on `supabase/.temp/linked-project.json`.

Then run `npx prettier --check .` (in the main folder, where `supabase link` has been run) and the other scripts; push; wait for `ci` green.

Everything else passed: rename complete, secret server-only, tests, CI hardening, scope.
