# Handoff: T-062 UI updates from D-21, D-22, D-25

From: frontend  To: tester

## What changed
- Branch: `feature/T-062-ui-rule-updates`
- Pull request: see the PR for issue #97 ("T-062: UI updates from D-21, D-22, D-25")
- Admin queue (`ChefQueueView.tsx`): an approved chef with a failed MOCK check shows a "Needs a look" flag (from `flagged`/`failedChecks`) with a MOCK badge. `ReviewSections.tsx` KitchenSection: a rejected chef shows an explanation and no review controls.
- Availability (`AvailabilityView.tsx`, `calendar.ts` `bookedDatesMessage`, `api/client.ts` now keeps `error.dates`): 409 `DATE_BOOKED` names the dates, takes focus (existing `useSection` focus), nothing is saved or shown as saved. Hint text no longer says unticking is harmless. Out-of-window day colour raised for dark-mode contrast (axe failure that appears once earlier days of the month exist).
- Chef page (`ChefDetailView.tsx`, `search/detail.ts`): "cannot be booked yet" state and `isBookable` removed; dates window starts at `firstBookableDay`; wording says booked days are left out. Search filter hint reworded the same way.
- Mocks: `mock-admin.ts` (rejected-chef kitchen review 409, reject turns chef's home off), `mock-adapter.ts` (409 `DATE_BOOKED`; the day 3 days from today is always "booked" in MOCK), `mock-search.ts` (hidden chef is 404, dates start tomorrow, `firstBookableDay`, search date must be after today).
- `parseSavedForm` uses the shared `TEXT_MAX` (40).
- `e2e-mock/helpers.ts` `blockStorage(page)`; used in every mock spec that renders photos. Specs updated: chef-detail (404 for the hidden chef), search wording, chef-detail-tester (second chef is Linh), plus new tests in admin-mock and chef-availability-mock. `e2e/search-real.spec.ts` follows D-25 (not run locally).

## How to verify
- `npm run lint`, `npx tsc --noEmit`, `npx prettier --check .`, `npx vitest run` (1519 pass), `npm run build`, `npm run test:e2e:mock` (121 pass).
- Real Playwright, API and RLS: CI.

## Known gaps or risks
- The MOCK "booked day" is a fixed demo rule (today + 3). The calendar e2e skips if that day is not in the visible month.
- `e2e/search-real.spec.ts` change is untested locally.
- The contract was not edited (no contract change).

## What the next agent needs
- A chef with only an unapproved chef's home is a 404 everywhere (D-25), including in mocks.
- Mock admin accounts: login email starting "admin"; Tuan Pham is the seeded approved chef, Rosa Lee the rejected one.
