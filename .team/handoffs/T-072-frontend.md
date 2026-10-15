# Handoff: T-072 UI follow-ups from T-066

From: frontend  To: tester

## What changed
- Branch: `feature/T-072-t066-ui-followups`
- Pull request: see the PR titled "T-072: UI follow-ups from T-066" (Closes #123)
- Files:
  - `src/lib/booking/changes.ts` (+ test): `isWaitingForCheck`, `pastUncookedDays`, `summaryAllDatesPast`, `chefNoShowTrialText` (uses `freeTrialEffect("no_show_chef", { anyDayCooked })`, D-37).
  - `BookingDetailView.tsx`: neutral "waiting for a check" note (`waiting-check`) when accepted, every day before today (Toronto) and none cooked; new chef no-show trial note (`trial-after-no-show`), used or not used up by cooked day, only for a free first booking.
  - `ChefBookingView.tsx`: prompt `mark-cooked-prompt` for past uncooked days ("Day 1 has passed and is not marked as cooked. Did you cook? Mark it as cooked ..."), plus `waiting-check` line when all days are past and none cooked; chef no-show note now adds the D-37 trial sentence.
  - `BookingList.tsx`, `ChefBookingList.tsx`: an accepted row with all dates past says "All visit days have passed. Open the booking to see what is next." (list rows have only dates, no cooked info, so this is also shown for a cooked booking that awaits completion; wording is true for both). Chef list group is still titled "Accepted", not upcoming.
  - Tests: `changes.test.ts`, `BookingDetailView.test.tsx`, `ChefBookingView.test.tsx`, `BookingList.test.tsx`, new `ChefBookingList.test.tsx`, new `e2e-mock/t072-waiting-check-mock.spec.ts` (axe, dark, 375 px, keyboard Enter on the mark button).

## How to verify
`npm run lint && npm run typecheck && npx prettier --check . && npm test && npm run test:e2e:mock` : all pass locally (215 mock e2e). `impeccable detect src/components/booking`: exit 0, no findings. Impeccable finish-reviewer/documenter skipped (D-44).

## Known gaps or risks
- The earlier `changes.ts` / `BookingDetailView.tsx` had no copy saying a chef no-show always returns the free booking (the Tester's T-070 finding was already gone); the only chef no-show text was neutral. I added the D-37 sentences rather than replacing any. Nothing in src, e2e-mock or README still says it always gives it back.
- Mock adapter: a chef-no-show only sets the status; trial effect is displayed from days, so it matches. There is no customer UI to report a chef no-show, so the new note is covered by component tests only.
- "Past" means date before today (Toronto). A day dated today is the normal "Mark as cooked" flow and gets no prompt.
- The chef prompt and customer note stay as long as the server leaves the booking accepted; the customer Cancel button still shows (server answers nothing_left). Not changed (out of scope).

## What the next agent needs
Open questions for Jimmy: Q-35 (explain the reason to both parties?) and Q-36 (final status when an admin resolves a D-36 flag; is it frozen like D-53, i.e. may the chef still mark past days?). The chef prompt assumes marking is still allowed, as built. If frozen, the prompt must go.
