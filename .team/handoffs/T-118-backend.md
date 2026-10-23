# Handoff: T-118 Mock mode cannot run in a Vercel production build

From: backend  To: tester

## What changed
- Branch: `feature/T-118-mock-guard`
- Pull request: https://github.com/Jimmyvo23/cookneighbour/pull/227 (Closes #223)
- Files: `src/lib/mock-guard.ts` (new, pure rule), `src/lib/t118-mock-guard.test.ts` (new, 24 tests), `next.config.ts`, `src/lib/api/client.ts` (`isMockEnabled`), `src/lib/server/page-guard.ts` (comment), `README.md`, `docs/work-orders/WO-T118-mock-guard.md`.

Approach (three layers, fail closed):
1. `next.config.ts` throws when any Vercel signal (`VERCEL`, `VERCEL_ENV`, `VERCEL_TARGET_ENV`, `VERCEL_URL`, `VERCEL_REGION`, `VERCEL_DEPLOYMENT_ID`, `NEXT_PUBLIC_VERCEL_ENV`, `NEXT_PUBLIC_VERCEL_URL`) is set and `NEXT_PUBLIC_API_MOCK` is non-blank (any value, so even "0" is refused: the README says leave it unset).
2. `isMockEnabled()` returns false when any signal is present. Every reader goes through it (grep: page-guard, ChatSection, upload.ts, GroceriesSection, ResultCard, ReviewSection and others; `mock-adapter.ts` is reached only through `apiFetch` and `isMockEnabled`). Reads are written out as literal `process.env.X` so Next inlines the NEXT_PUBLIC_ ones into the browser bundle; non-public ones are undefined in the browser.
3. `next.config.ts` inlines `NEXT_PUBLIC_MOCK_BLOCKED` ("1" on Vercel) into the client bundle, so the browser knows even if Vercel does not expose `NEXT_PUBLIC_VERCEL_*`.
Extra (builder choice): `NODE_ENV=production` (build or `next start`) with the flag "1" needs `ALLOW_MOCK_BUILD=1`. Reason: Vercel docs say `VERCEL` etc. exist only while "Enable access to System Environment Variables" is on; if that is off, none of the signals exist, and this rule still stops the build. `ALLOW_MOCK_BUILD` never overrides Vercel. Dev server (`npm run dev`, used by the CI e2e-mock job) is unaffected.
I first tried `NEXT_PHASE` for "production build"; it is undefined when next.config loads, hence `NODE_ENV`.

## How to verify
- `npx vitest run src/lib/t118-mock-guard.test.ts` -> 24 pass. Full `npm test` -> 3223 pass, 3 expected fail. `npm run lint`, `npx tsc --noEmit`, `npx prettier --check .` clean.
- `VERCEL=1 NEXT_PUBLIC_API_MOCK=1 npx next build` -> exit 1 "T-118 mock guard". Same with `VERCEL_ENV=preview` + `=0`, and `NEXT_PUBLIC_VERCEL_ENV=production` + `=1`.
- `NEXT_PUBLIC_API_MOCK=1 npx next build` -> exit 1 (needs ALLOW_MOCK_BUILD); with `ALLOW_MOCK_BUILD=1` -> builds, bundle has "MOCK API"; plain build and `VERCEL=1` build with the flag unset -> build, bundle has `NEXT_PUBLIC_MOCK_BLOCKED:"1"`.
- Bite: with `mockAllowed` ignoring Vercel and the Vercel refusal disabled, 15 of 24 tests fail; `VERCEL=1 ... next build` then still failed only because of layer 3's opt-in rule.
- Not run locally (port 3101): any Playwright e2e. CI e2e-mock covers it.

## Known gaps or risks
- Vercel docs verified (fetched https://vercel.com/docs/environment-variables/system-environment-variables.md on 2026-10-23): `VERCEL=1` at build and runtime; `VERCEL_ENV` production|preview|development at build and runtime; `VERCEL_REGION` exists. Not verified live: that a real Vercel build exposes these, the exact set of `NEXT_PUBLIC_VERCEL_*` names, and behaviour with system variables disabled (documented, not tested). No real Vercel build was run.
- Other hosts (not Vercel) get only the `ALLOW_MOCK_BUILD` rule for production builds.
- Setting a blank `NEXT_PUBLIC_API_MOCK` on Vercel is allowed; "0" is refused (stricter than needed, deliberate).
- The README NIT lines moved slightly: "main folder" at :130 matched; the `main` + `**` note went on step 4 (:133); "made-up details" went on the sign-up smoke-test line (:148) because no line there had other wording. Prettier also reflowed README table spacing.
- Anyone running `next start` on a mock build locally must now set `ALLOW_MOCK_BUILD=1` too.

## What the next agent needs
- Tester: try odd values (" 1", "true"), each Vercel name alone, and check the browser bundle for `NEXT_PUBLIC_MOCK_BLOCKED:"1"` after a `VERCEL=1` build. Confirm e2e-mock and the `ci` gate stay green.
- Reviewer: README text against the code; whether refusing "0" and the ALLOW_MOCK_BUILD rule are wanted (unconfirmed by Jimmy).

## Round 1
Tester PASS at c10a510 with three doc findings, all fixed (docs only, no code change):
- LOW-1 `README.md` (known limits): the "other hosts have no such guard" sentence now says a production build or `next start` with the flag at `1` stops unless `ALLOW_MOCK_BUILD=1` is set, and that a host that sets that variable, or `next dev`, is not protected.
- LOW-2 `README.md` (env var list): now says the app looks for any of the Vercel system variables listed in `src/lib/mock-guard.ts`.
- LOW-3 `.env.example`: one comment line about `ALLOW_MOCK_BUILD` (local production mock builds only, never on Vercel); no value that enables it.
Checks: `prettier --check .` and `npm run lint` clean.

## Round 2
Reviewer APPROVED at 98ed19f with two README findings and one INFO, fixed (docs only):
- LOW-1 `README.md` env section: now says two flags are also inlined, `NEXT_PUBLIC_API_MOCK` and `NEXT_PUBLIC_MOCK_BLOCKED` (set to `1` by the build on Vercel; not a secret).
- LOW-2 `README.md` env list and known limits: both now say the Vercel refusal and runtime ignore work only while "Enable access to System Environment Variables" is on; if off, only the `ALLOW_MOCK_BUILD` rule stops a `1`.
- INFO-2 `docs/security-review.md` item 5: kept the historical text, added an "Addressed by T-118" note pointing at `isMockEnabled()` in `src/lib/api/client.ts` and `src/lib/mock-guard.ts`.
Checks: `prettier --check .` and `npm run lint` clean.
