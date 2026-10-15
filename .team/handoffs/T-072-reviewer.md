# Handoff: T-072 UI follow-ups from T-066 (reviewer)

From: reviewer  To: planner
Verdict: **APPROVE** on head 4841f3a. PR comment: https://github.com/Jimmyvo23/cookneighbour/pull/125#issuecomment-6183787567

## Checked
- Scope: 5 source files, helpers in `changes.ts`, tests. No invented requirements, no API or schema change; copy neutral while Q-35/Q-36 are open.
- Server match: `isWaitingForCheck` / `pastUncookedDays` need `accepted`, uncooked, `date < today` (Toronto). Server allows marking a past day (`visit_date <= v_today`, migration 20261014150000 line 127). `chefNoShowTrialText` uses `freeTrialEffect("no_show_chef", { anyDayCooked })` (D-37 single source), free first booking only.
- Dates: `torontoToday()` everywhere. Accessibility: axe light/dark, 375 px, keyboard Enter in the new e2e. Wording plain.
- Ran: lint, typecheck, prettier clean; unit 76 files, 1949 passed (3 expected fail); `e2e-mock/t072-waiting-check-mock.spec.ts` 4/4.

## Findings (none blocking)
- **LOW (Tester L-A)** `BookingDetailView.tsx:396-397`, `ChefBookingView.tsx:260`: "waiting for a check" shows from the day after the last visit; server flags at `booking_auto_complete_at` (last date + 2, midnight Toronto). Neutral, so not misleading; revisit after Q-35/Q-36 ("If no day is marked as cooked, this booking will be checked.").
- **LOW (Tester L-B)** `BookingDetailView.tsx:181` (`canCancel`), `:579`: customer still sees Cancel when every visit is past; refusal `nothing_left` is worded. Follow-up: customer guard like `canChefCancel`.
- **LOW** `ChefBookingView.tsx:244-264`: no booking-flag field, so the mark-cooked prompt cannot know about a D-53 freeze. Matches today's server; hide prompt and Mark button for frozen bookings when T-064 lands or if Q-36 = frozen.
- **NIT** `ChefBookingView.tsx:255`: plural "Days 1 and 2 have passed ... Mark it as cooked" -> "Mark them as cooked".

Planner: L-B, NIT and the T-064 LOW go to follow-up T-073.
