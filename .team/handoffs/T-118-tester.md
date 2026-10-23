# Handoff: T-118 Mock mode cannot run in a Vercel production build (Tester)

From: tester  To: reviewer

Verdict: **PASS** (commit c10a51012a0d9def35956c0a68feadf790204f73, PR #227). No code was changed by the Tester.

## What changed
- Branch: `feature/T-118-mock-guard`; PR https://github.com/Jimmyvo23/cookneighbour/pull/227
- Tester added no files except this handoff (uncommitted).

## How to verify (what I ran)
Real `next build` matrix (sequential, same worktree):
| Env | Result |
|---|---|
| none | builds |
| MOCK=1 | exit 1 "needs ALLOW_MOCK_BUILD=1" |
| MOCK=1 + ALLOW=1 | builds |
| MOCK=1 + ALLOW=0, MOCK=" 1" | exit 1 (ALLOW rule) |
| MOCK=true (no Vercel) | builds (mock stays off at runtime, "1" only) |
| VERCEL=1, flag unset or blank | builds |
| VERCEL=1 + MOCK=1 / 0 / true | exit 1 "Vercel build" |
| VERCEL=1 + MOCK=1 + ALLOW=1 | exit 1 (ALLOW does not override) |
| VERCEL_ENV=production + MOCK=1 | exit 1 |
| NEXT_PUBLIC_VERCEL_URL + MOCK=1 | exit 1 |
Client bundle, `VERCEL=1` build: the string "MOCK API" is still in one chunk (code is shipped), but it sits behind `isMockEnabled()`, and the inlined function has `NEXT_PUBLIC_MOCK_BLOCKED:"1"` plus the Vercel names, so it returns false. A grep for the badge string therefore cannot prove "off"; the inlined `NEXT_PUBLIC_MOCK_BLOCKED:"1"` does.
`next start` (production build with mock): with MOCK=1 and no ALLOW the server prints "Ready", then fails to load next.config and serves nothing (curl 000); with ALLOW=1 serves 200; with VERCEL=1 + MOCK=1 + ALLOW=1 fails to load config. Port 3199 used, port 3101 untouched, nothing left listening.
Bite tests (each mutation applied, `vitest run src/lib/t118-mock-guard.test.ts`, then reverted with git checkout; worktree clean afterwards). Baseline 24 pass.
| Protection removed | Failing tests |
|---|---|
| Vercel build refusal in `mockBuildProblem` | 3 |
| `mockAllowed` ignores Vercel | 12 |
| `mockBlockedFlag` returns "" | 2 |
| client.ts drops `NEXT_PUBLIC_MOCK_BLOCKED` read | 1 |
| client.ts ignores `VERCEL` | 1 |
| next.config no longer inlines NEXT_PUBLIC_MOCK_BLOCKED | 1 |
| next.config does not throw | 2 |
| ALLOW_MOCK_BUILD rule removed | 2 |
| `NEXT_PUBLIC_MOCK_BLOCKED` removed from VERCEL_SIGNS | 3 |
Every protection has a test that bites.
Suites: `npm run lint` clean; `npm run typecheck` clean; `prettier --check .` clean; `vitest run` 148 files, 3223 passed, 3 expected fail.
Not run (per instruction): Playwright / e2e-mock. CI e2e-mock green on run 39973940466 (not re-fetched by me).

## Reader audit
- Only `src/lib/api/client.ts:10` reads `process.env.NEXT_PUBLIC_API_MOCK` (apart from tests and the two playwright configs, which set it). All 16 consumers in `src/` use `isMockEnabled()`, including `src/lib/server/page-guard.ts:52`. No bypass found.
- `playwright.mock.config.ts:19` runs `npm run dev` with MOCK=1 (NODE_ENV=development), so the ALLOW rule does not apply. `playwright.config.ts:40` forces it blank. `.github/workflows/ci.yml:47` is `npm run build` with no mock flag. No script or workflow runs a production build or `next start` with MOCK=1, so nothing is broken.

## Findings
HIGH / MEDIUM: none.
LOW:
1. `README.md:176` says "other hosts have no such guard". Not exactly true: a production build or `next start` with the flag on any host needs ALLOW_MOCK_BUILD=1. Reword.
2. `README.md:122` lists five Vercel names; the code also checks `VERCEL_TARGET_ENV`, `VERCEL_DEPLOYMENT_ID`, `NEXT_PUBLIC_VERCEL_URL` (`src/lib/mock-guard.ts:15-25`). Say "any of the Vercel system variables" or list all.
3. `ALLOW_MOCK_BUILD` is documented only in `README.md:83` (and error text). It is not in `.env.example:21-23` next to `NEXT_PUBLIC_API_MOCK`, and the e2e-mock instructions do not mention it (no need for dev server, but anyone running `build` + `start` with the flag will hit the refusal). Suggest one line in `.env.example`.
4. `docs/security-review.md:77` still describes the old risk ("If `NEXT_PUBLIC_API_MOCK=1` were set on a deployment...") with line refs `client.ts:6`; historical, but the line number is now stale. Optional.
NIT:
5. `next start` with the refused combination prints "Ready" before failing to load the config, so the log looks healthy for a moment; the server then serves nothing. Cosmetic.
6. The extra ALLOW_MOCK_BUILD rule and refusing MOCK="0" on Vercel are Backend choices not approved by Jimmy (as Backend noted); Reviewer/Planner to confirm.
7. Not verified live: a real Vercel build exposing these variable names (Backend's doc check only; I did not fetch Vercel docs).
README deploy text otherwise matches the code: README:122 refusal and runtime-ignore, :126 inlined-as-empty (really undefined/empty, harmless), :133 `main` + `**` note matches `vercel.json`, :83 ALLOW note true.

## What the next agent needs
Reviewer: decide on LOW 1-3 wording and the unapproved extra rule. Nothing blocks merge.
