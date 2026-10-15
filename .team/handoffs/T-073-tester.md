# Handoff: T-073 Contact window UI (Tester)

From: tester  To: reviewer

## Verdict: PASS (no blocking bugs; 1 LOW wording issue, 3 INFO notes)

## What changed
- Branch `feature/T-073-contact-window-ui`, PR #130, builder head f39133b.
- Tests added (tests only): `src/lib/mocks/mock-bookings.contact-tester.test.ts` (7): mock `viewOf` against the server cut-off `booking_contact_ends_at` (`(max(visit_date)+8)::timestamp at time zone 'America/Toronto'`): summer 04:00Z, exact flip at the instant (3:59:59.999 vs 04:00:00.000, both roles), November change (Oct 24 -> Nov 1 04:00Z EDT; Oct 25 -> Nov 2 05:00Z EST), March 2027 change, multi-day with days listed out of order, one-day booking (visible day 7, hidden day 8), requested/cancelled/declined/expired never show contact or a window. Dates are fixed calendar dates with explicit instants (no "today", so no UTC-today risk).

## How to verify
`npm run lint && npm run typecheck && npx prettier --check . && npm test && npm run test:e2e:mock`
Local results: lint, typecheck, prettier clean; unit 78 files, 1978 passed + 3 expected fail; mock e2e 220 passed.

## Checks
1. D-52 explanation on customer and chef pages: present (`contact-window`, `contact-later`), covered by builder tests, re-read in code. OK.
2. "Visible until ... (Toronto time)" = `contactVisibleUntil` formatted with a Toronto formatter; mock value equals the SQL cut-off (DST, multi-day, boundary: my new tests). OK.
3. "Contact details are hidden now" for accepted / completed / both no-shows once contact is null; cancelled: "locked" text, no window promised (D-56); requested and declined/expired keep their own lines. OK.
4. Customer Cancel: `canCustomerCancel` hidden when all days are before today (Toronto), shown with a day today/later and for requested; matches server `nothing_left`. OK.
5. Plural "Mark them as cooked" vs "Mark it". OK.
6. D-59: the focused alert (e2e asserts `toBeFocused`, role alert) sits above Decline. Compare with contract v1.10 (branch feature/T-074-kitchen-followups, 7A accept, `reason: kitchen_address_missing`): the server message is "You have no kitchen address saved, so you cannot accept a chef's-home booking. Decline this request, or add your kitchen address to your application first (an admin then checks your kitchen again)." The UI text ("Your kitchen address is missing ... Adding a kitchen address switches cooking at your home off until an admin checks it again, so declining this request is the practical choice.") does NOT conflict: same facts (decline, or add an address and wait for the admin recheck). The UI wording wins because `EXTRA_REASONS` is read before `error.message`; so the server message is never shown for this reason. Answer to the builder's question: no need to prefer `error.message`; just keep the two in step if either changes. The check order (chef_home_not_enabled first) matches the UI mapping.
7. Mock adapter mirrors server: yes for the cut-off and statuses (new tests). 

## Findings
- F-1 (LOW, false promise, lessons-learned section 3 row "False promises in the UI"): every contact line ends "Chat stays open." in the present tense, but chat does not exist yet (T-046 / T-047 are todo; no messages route or page in `src/app`). D-52 says chat stays, so it is the intended rule, but today the page promises a feature the user cannot use. Repro: open any accepted booking page, read `contact-window`. Suggest the Reviewer/Planner either accept it (the sentence describes the rule) or drop "Chat stays open." from `CONTACT_RULE` until T-047 ships. Not blocking.
- F-2 (INFO): the customer page rule says "addresses are hidden 7 days after the last visit day" while the customer's own cooking address stays visible (a test asserts that). Reads fine as "the other person's"; no change needed.
- F-3 (INFO): mock `bookingRoutes` call `viewOf(row, role)` without passing the injected `now` (lines 743, 817, 893 of `mock-bookings.ts`), so route-level tests cannot move the clock; the cut-off is only testable through `viewOf` directly (as my tests do). No behaviour bug.
- F-4 (INFO): "12:00 a.m." can read as ambiguous (builder's question 1); it is exact. Planner/Jimmy call.
- Not covered by design: a page left open across the cut-off keeps old text until reload (builder noted).
- RLS duplicate-date flake in `tests/rls/storage.test.ts`: not seen locally (DB tests run only in CI); see CI below.

## CI
ci green on head 758bbf7 (run 38754703676), including DB, RLS and API tests. The RLS duplicate-date flake in storage.test.ts did not recur.

## Round 2 (head 6affb93 plus one test commit): PASS

- Local on 6affb93: lint, typecheck clean; unit 1978 passed + 3 expected fail; mock e2e 220 passed.
- D-63: grep of src, e2e, e2e-mock, docs finds "Chat stays open" only in not.toContain assertions (4). Gone from CONTACT_RULE and CONTACT_LOCKED_TEXT. OK.
- D-64: `contactOpenText` uses (until - 1 ms) in America/Toronto, weekday/month/day, no clock time. Missing and unreadable `until` fall back to the rule only. OK.
- Added test (tests only) in `src/lib/booking/changes.test.ts`: spring-forward edge (Mar 2027, 23-hour day), fall-back (25-hour day Nov 1), Oct 31 EDT to Nov 1 cut-off, +1 ms past midnight (next day), empty-string `until`. 36 tests in file pass.
- N-1: `KITCHEN_ADDRESS_MISSING_MESSAGE` is one constant used by EXTRA_REASONS and the mock server. OK.
- N-2: `detailRoute(..., now)` now passes `now` to `viewOf`. OK.
- Findings: none blocking. INFO: a page left open across the cut-off keeps old text until reload (accepted).
