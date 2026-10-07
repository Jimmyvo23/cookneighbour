# Handoff: T-020 App scaffold (test result)

From: tester  To: reviewer

## What changed
- Verdict: **PASS**
- Branch: `feature/T-020-app-scaffold` (PR #45, Issue #8), tested in a fresh clone. No files changed by the tester except this handoff.

## How to verify (results from fresh clone, `npm ci`)
- `npm run lint`: exit 0
- `npm run typecheck`: exit 0
- `npm test`: exit 0 (1 file, 2 tests passed)
- `npm run build`: exit 0 (routes `/`, `/_not-found` static)
- `npm run test:e2e`: exit 0 (1 test passed, Chromium)
- `npx prettier --check .`: exit 0
- `npm run dev` (port 3200): home page contains "CookNeighbour — prototype"
- `.env.example`: only empty placeholders (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY); tracked in git
- `git check-ignore`: `.env` and `.env.local` ignored (rule `.env*`); `.env.example` NOT ignored (rule `!.env.example`)
- PR file list vs main: no changes to CLAUDE.md, .claude/, docs/. Only `.team/` change is the builder's own `.team/handoffs/T-020-frontend.md` (expected handoff file).

## Known gaps or risks
- `npm audit --omit=dev`: 0 vulnerabilities. Production code is not affected.
- `npm audit` (all): 5 high, all one chain: `braces` (ReDoS/stack exhaustion, GHSA-vfj7-8cjw-p6xm) -> `micromatch` -> `fast-glob` -> `@next/eslint-plugin-next` -> `eslint-config-next`. Dev dependency (lint tooling) only; `npm ls --omit=dev braces` is empty, so it never reaches production or the build output. Audit suggests `--force` fix; not recommended blindly. Suggest tracking for a later bump of eslint-config-next.
- `npm ci` warns about install scripts for fsevents and unrs-resolver not covered by allowScripts (informational, install still works).
- Handoff text says "5 high" which matches.

## What the next agent needs
Nothing blocking. CI-red check belongs to T-022.
