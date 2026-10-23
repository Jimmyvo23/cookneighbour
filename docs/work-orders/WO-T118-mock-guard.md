# Work Order WO-T118: Mock mode cannot run in a Vercel production build

Task: T-118 (backend), Issue #223. Branch `feature/T-118-mock-guard`, worktree `../CookNeighbour-wt-T118`. Jimmy 2026-10-23: "Yes, before deploy (Recommended)" (D-176). Runs in parallel with T-115 and T-116 (Jimmy 2026-10-23: "Parallel", "These 3 tasks").

| Agent | Task | Plan (100 words or fewer) | Effort | Risk |
|---|---|---|---|---|
| backend | T-118 | Test first. `NEXT_PUBLIC_API_MOCK=1` must not turn on the mock adapter or skip the server page guards in a Vercel build (`src/lib/api/client.ts` `isMockEnabled`, `src/lib/server/page-guard.ts`; other readers: `ChatSection.tsx`, `chef/upload.ts`, `mocks/mock-adapter.ts`). Fail closed: refuse the build (next.config) when Vercel and mock are both set, and make the runtime check false on Vercel too. Local and CI e2e-mock builds keep working. Plus T-055 README NITs (README:130 "main folder" -> "repo folder"; :133 say the `main` + `**` combination was not tried live; :149 "made-up details"). | S-M | Vercel env names must come from Vercel docs; e2e-mock CI must stay green |
| tester | T-118 checks | Bite test: remove the guard and watch the tests fail. Vercel+mock build refused; e2e-mock and unit suites green. | S | Low |
| reviewer | T-118 review | No path left where mock mode or skipped guards reach a Vercel build; README text true. | S | Low |
