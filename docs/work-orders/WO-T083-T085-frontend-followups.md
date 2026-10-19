# Work Order WO-T083-T085: Frontend follow-ups (409 texts and mock seed)

Tasks: T-083, T-085. Asked for 2026-10-19 so that every agent has work during the next hour, alongside T-084. Approved by Jimmy 2026-10-19 (D-90), with D-84 relaxed for that hour only.

## Plan per agent

| Agent | Task | Plan (100 words or fewer) | Effort (S/M/L) | Risk |
|---|---|---|---|---|
| frontend | T-083 + T-085, one branch `feature/T-083-T-085-frontend-followups` | T-083: drop "Reload the page to see its status." from the 409 texts now that the page reloads itself (`src/lib/booking/changes.ts`, `BookingDetailView.tsx`) and update the tests that check this text; give `Refusal409.test.tsx` and the T-080 mock e2e realistic "later" states (`noShow`, `cancelledBy`/`cancelledAt`); clear the page refusal when a section (receipts) succeeds; NIT-1..4. T-085: move mock seed dates so no chef has two bookings on one date (`pickedUpSeeded` day 2 vs A04 day 2; A03 vs A06), and update the mock specs that depend on them. Run the full local unit and mock e2e suites. | M | Changing seed dates can break other mock specs; grep every spec for those bookings first |
| tester | T-083 + T-085 checks | Check each review item is fixed; add a unit check that the mock seed has no duplicate chef+date; run unit and mock e2e. | S | Low |
| reviewer | T-083 + T-085 review | Standard review: wording, accessibility of the refusal clearing, no new behaviour beyond the listed items. | S | Low |

## Left out
T-046 messaging (WO-5). It starts after T-084, under D-84.

## Decision
Decide ids `WO-T083-frontend`, `WO-T083-tester`, `WO-T083-reviewer`.
