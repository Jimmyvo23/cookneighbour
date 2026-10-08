# Work Order WO-3: Phase 3 — Chef side

Tasks: T-031, T-032, T-033, T-034, T-035, T-036
Approval: pre-approved by Jimmy on 2026-10-07 (WO-3 to WO-6), recorded with `team-status decide`. Quality over speed: every task goes Builder → Tester → Reviewer.

| Agent | Task | Plan (100 words or fewer) | Effort (S/M/L) | Risk |
|---|---|---|---|---|
| backend | T-031 Chef onboarding API | Implement the contract's chef application routes (GET/PATCH application, documents POST/DELETE, submit). Service role writes after checks (D-12). GET repairs missing chef rows (T-028 N-e). Routes apply the N1 re-verification reset; a re-upload of a `failed` document moves it to `pending`. Validate storage paths and object existence. MOCK ID / food-handler / police / kitchen statuses labelled. Test that a JWT `user_metadata.role` is ignored. API tests for every route and reset rule. | L | Missed reset path lets a swapped file stay verified; covered by route tests |
| backend | T-032 Dishes and availability API | Extend the contract (v1.1) for dishes and availability, then build the routes: create, edit, deactivate dishes (cook minutes, ingredient cost in cents, servings, allergens, shelf-life days, photo in own folder); set and clear available dates. Decide whether these stay client-writable under RLS or move to routes; document it. Tests for ownership, validation and pending-chef visibility. | M | Contract drift; Frontend codes against the merged contract only |
| backend | T-035 Admin chef-queue API | Admin routes from the contract: list (with a "checks pending" filter), detail, approve (only from `pending`, both checks still `verified` in the same conditional update), reject with reason, MOCK checks update naming the reviewed files, kitchen review (allow `reviewedAddress: null`), police status. Admin role checked before any query. API tests including the swap-while-pending race. | M | Approve race; tested with a conditional-update test |
| frontend | T-033 Chef onboarding and profile UI | Chef application pages: profile, cuisines, languages, hourly rate, service area, location options, document and kitchen-photo upload to Storage then register via the API, allergen and hygiene acknowledgements, submit and status view (pending / rejected with reason / approved). Server-side guard (chef only) because the pages show private data. MOCK badges on every check status. axe and keyboard tests. | L | Upload flow errors; e2e against real routes in CI |
| frontend | T-034 Dish menu and availability UI | Chef dish list and editor (with allergen picker and photo upload), availability calendar (mobile-friendly, keyboard accessible). Built against contract v1.1. Server-side chef guard. e2e against real routes. | M | Calendar accessibility; axe + keyboard tests |
| frontend | T-036 Admin chef-queue UI | Admin queue and detail: documents viewer (signed URLs), approve / reject with reason, MOCK check controls naming the reviewed file, kitchen review, police status, "checks pending" filter. Server-side admin guard. MOCK badges everywhere a check status appears. e2e: admin approves a new chef (CLAUDE.md §12 step 5). | M | Admin sees stale file; UI sends reviewed paths per contract |
| tester | Verify every WO-3 PR | Fresh clone, all scripts, CI log review, contract conformance, RLS and API tests, edge cases from CLAUDE.md §10 that apply, axe and keyboard checks on UI. Writes `.team/handoffs/<task>-tester.md`. | M | None notable |
| reviewer | Review every WO-3 PR | Security, privacy, MOCK honesty, contract match, accessibility, plan compliance. | M | None notable |

Order (one build task at a time): T-031 → T-033 → T-032 → T-034 → T-035 → T-036. Backend updates `docs/api-contract.md` before the dependent Frontend task starts.

## Recommendation
Approve all (pre-approved). Folds in review follow-ups from T-025, T-026, T-028 and T-057.

## Left out
Search, booking, pricing, free trial (WO-4). Messaging, reviews, reports (WO-5). Kitchen-address change while a chef's-home booking is accepted (WO-4, no bookings exist yet). Hosted seed data (needs Jimmy). Deploy (WO-7).

## Decision
Pre-approved by Jimmy 2026-10-07. Recorded as `WO-3-backend`, `WO-3-frontend`, `WO-3-tester`, `WO-3-reviewer`.
