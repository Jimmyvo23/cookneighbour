# Work Order WO-T098: Reviews and reports written only by the route

Task: T-098 (backend), from the T-053 security review (`docs/security-review.md`, MED-1 and LOW-1). Branch `feature/T-098-route-only-writes`, worktree `../CookNeighbour-wt-T098`. Jimmy 2026-10-21: "Start MED-1 + LOW-1 now (Recommended)" (D-150). Starts after Backend hands off T-097.

| Agent | Task | Plan (100 words or fewer) | Effort (S/M/L) | Risk |
|---|---|---|---|---|
| backend | T-098 | Test first. New migration: drop the browser insert policies on `reviews` and `reports`, revoke the `authenticated` insert grants, and write both through the service role (or service-role-only SECURITY DEFINER functions with `search_path = ''`) after the route's checks, keeping the party, status and window rules in the database too. RLS tests: a browser insert into either table fails with 42501; route behaviour unchanged (contact filter, unsafe text, empty text, rate limit, `client_id` retry). Contract note. | M | Hosted `db push` needs Jimmy after merge; route must still refuse non-parties |
| tester | T-098 checks | Direct PostgREST inserts refused for customer, chef, admin and anon; every existing review and report route test still passes; retry and duplicate rules unchanged. | M | RLS suite runs only in CI |
| reviewer | T-098 review | No browser write path left (grants, policies, functions, storage), definer functions safe, error texts unchanged, migration reversible and documented. | S | Low |

## Decision
Decide ids `WO-T098-backend`, `WO-T098-tester`, `WO-T098-reviewer`.
