# T-045 Reviewer handoff (saved by the Planner from the Reviewer's report)

PR #112, head reviewed ed909ce (app code = 0d968a7). Verdict: REQUEST CHANGES (one MEDIUM). Lint, typecheck, prettier clean; unit 1837 pass (3 expected fails); `ci` green on ed909ce.

## MEDIUM (must fix)

M1. Privacy wording on finished bookings, `src/components/booking/ChefBookingView.tsx`:
- 541-546 `KitchenNote`: for every status other than requested/accepted it says the kitchen address was shared "only while the booking was accepted". The server keeps it visible to the customer for `completed`, `no_show_customer`, `no_show_chef` (`booking_contact_unlocked`, `supabase/migrations/20261007221002_core_rls.sql:48`; contract 7A "Who sees what"). For declined, expired, or cancelled-before-accept it was never shared.
- 501-505 `address-later` and 513-517 `contact-later`: "shown once you accept" also shows on declined/expired/cancelled bookings.
- Fix: word the kitchen note per status; show "once you accept" hints only while `requested`; component tests for a completed and a declined booking.

## LOW

- L1 `PickupSections.tsx:486-489`: say "Later days that were not cooked are cancelled" (server cancels only uncooked days after today).
- L2 `src/lib/booking/changes.ts:171-173`: `pickupWindowPassed` comment wrongly says "no pickup time was agreed".
- L3 Focus lost after "Go back" (`ChefBookingView.tsx:687-690`, `GroceriesSection.tsx:776-779`) and "Keep waiting" (`PickupSections.tsx:500-506`): return focus to the opening button.
- L4 A repeated identical success notice is not re-announced or focused (`GroceriesSection.tsx:150-152, 165-168`; `ChefBookingView.tsx:163-169`).
- L5 `GroceriesSection.tsx:582-585`: every upload failure says "Check your connection".
- L6 `ChefBookingList.tsx:13` imports `CHEF_STATUS_TEXT` from the client `ChefBookingView` module: move to `src/lib/booking/changes.ts`. The announce-and-focus notice block is copied in three components (optional share).
- L7 (info) `safeFileUrl` allows `http:` (needed locally); consider https-only on https pages.

## Checked and OK

Server guards (`requireChefPage` layout + pages, fail closed); addresses/phones only when the API sends them; no storage URLs in mock mode; upload path `receipts/<booking id>/<uuid>.<ext>`, `upsert: false`, chef session; signed links http(s) only, `noopener noreferrer`, refetch every 8 min; every change and receipt refusal reason worded; limits match; mock data uses real domain functions; MOCK and trial wording honest; focus ownership, per-instance ids, labels; scope within WO-4b (customer pickup and receipt answer needed by the named flows); T-070 items left out.

## Impeccable trial (Reviewer's view)

Follows PRODUCT.md: allergies and conflicts before Accept/Decline, eat-by on every dish, MOCK everywhere it applies, privacy per API (apart from M1). Consistent with existing pages (shared card, button, info/warning styles; no new colours, fonts or icons). Some sentences are long for English learners (e.g. chef's-home "Visit done" paragraph, `ChefBookingView.tsx:734`). Static `detect` added nothing; value came from the reference guides plus axe, 375 px and dark-mode checks. No screenshots seen.
