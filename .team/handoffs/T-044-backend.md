# Handoff: T-044 Grocery options API

From: backend  To: tester

## What changed
- Branch: `feature/T-044-grocery-options` (from main 355db02)
- Pull request: see the PR for branch `feature/T-044-grocery-options` ("Closes #32", WO-4b)
- Contract: `docs/api-contract.md` **v1.6**: new section 7B; the T-043 carry-in (`days[].labourCents` is AFTER the free-trial waiver, 0 under the trial, waived amount only in the totals) in 7A; route table; new notification types.
- Migration (new, one): `supabase/migrations/20261014100000_grocery_receipts.sql`
  - `receipts`: `superseded_at`, `customer_disputed_at`, `dispute_note`; unique `file_path`; one current receipt per booking (partial unique index); not both confirmed and disputed.
  - `submit_receipt` and `answer_receipt` (SECURITY INVOKER, `search_path = ''`, service_role only). Booking row locked FOR UPDATE, state re-checked under the lock, one transaction; `answer_receipt` is a single conditional UPDATE. Lock order: booking row only.
  - Storage: `receipts_insert_chef` replaced: upload only for a `chef_shops` booking while `accepted` or `completed` (round 2: option B added; helper `booking_accepts_receipts`). Still no update/delete policy, so insert-only.
  - NOT pushed to hosted. The Planner asks Jimmy after merge (`npx supabase db push --linked`, then `migration list --linked`).
- Files:
  - Domain: `src/lib/domain/groceries.ts` (+ `groceries.test.ts`, 33 unit tests). Reuses `receipt.ts` (`checkReceipt`, A-15) and `isSafeStoragePath`.
  - Server: `src/lib/server/groceries.ts`; types in `src/lib/api/types.ts`.
  - Routes: `src/app/api/bookings/[id]/shopping-list/route.ts` (GET), `.../receipts/route.ts` (GET, POST), `.../receipts/[receiptId]/respond/route.ts` (POST).
  - Tests: `tests/api/groceries.test.ts`, `tests/rls/receipts.test.ts`.

## How to verify
- Local: `npm run lint`, `npm run typecheck`, `npm test` (all pass: 1658 passed, 3 expected fail, same as main).
- The migration was applied to all 12 migrations in PGlite and `submit_receipt` / `answer_receipt` logic was exercised (waiting, confirmed, path_used leaves the old receipt unsuperseded, superseded, notifications).
- API and RLS tests run in CI only (no Docker here): `npm run test:api`, `npm run test:rls`.
- Routes: GET `/api/bookings/:id/shopping-list`; GET and POST `/api/bookings/:id/receipts`; POST `/api/bookings/:id/receipts/:receiptId/respond`.

## Known gaps or risks
- API and RLS suites were not run locally; CI is the first run. If a test fails, suspect test setup before logic.
- MOCK: reimbursement is recorded (`reimbursement: { mock: true, collected: false, amountCents }`), never collected. No grocery API, no markup.
- The mismatch flag is computed in the route from the immutable `est_ingredients_cents` snapshot (not inside SQL) with the existing domain rule; there is no race because the snapshot never changes.
- Receipt files are stored by the chef's own session in `<booking id>/<name>` (the existing bucket convention is the booking-id folder, not the chef's user-id folder; same insert-only and new-name-per-upload guarantees).
- Orphan files: an uploaded file that is never registered stays in the bucket (cannot be deleted by clients). Cleanup would delete data, so it needs Jimmy's approval.

## Open questions for Jimmy (interim behaviour in brackets)
1. Q-T044-1: Dishes have only an estimated ingredient cost, not an ingredient list. [Interim: the shopping list is per dish: name, quantity, servings, allergens, estimated grocery cost.] A per-ingredient list needs a dish field and chef effort.
2. Several receipts per booking (several shops)? [Interim: one current receipt at a time; after a dispute the chef replaces it; the chef sends one total.]
3. A-15 tolerance (max of 15% or $5.00) still pending Jimmy.
4. A dispute that is never resolved: who decides? [Interim: nothing happens automatically; an admin view of disputed receipts belongs to WO-5.]
5. Receipt statuses: the route allows receipts and answers while the booking is `accepted` or `completed` only (not after cancel or no-show). Confirm that is wanted.

## What the next agent needs (T-045 frontend, and the Tester)
- Read contract section 7B. Types are in `src/lib/api/types.ts`: `ShoppingListResponse`, `ReceiptView`, `ReceiptList`, `SubmitReceiptRequest`, `AnswerReceiptRequest`.
- Chef receipt flow in the browser: (1) upload the file with the chef's Supabase session to bucket `receipts` at `<booking id>/<new unique name>.png|jpg|jpeg|pdf` (a fresh uuid in the name; never upsert), (2) `POST /api/bookings/:id/receipts { filePath, amountCents }` (integer cents). Show the 409 `reason`s: `not_chef_shops`, `wrong_status`, `receipt_waiting`, `receipt_confirmed`, `path_used`.
- Customer: `POST .../respond { action: "confirm" }` or `{ action: "dispute", note }` (3 to 300 chars). Flagged receipts (`mismatchFlagged`) must be shown with `differenceCents` and `toleranceCents` and need an explicit answer.
- Show a MOCK badge wherever reimbursement appears; `reimbursement.amountCents` is set only after confirmation. `fileUrl` is a 10 minute signed link; refetch for a fresh one.
- Option A at the chef's home: `plan.customerDeliversToChef` is true; show `plan.note`.
- `days[].labourCents` is after the free-trial waiver (0 under the trial).
- Tester ideas: Unicode and long file names, PDF vs PNG, receipts on a completed booking, answer on cancelled booking (409 wrong_status), many parallel uploads, signed link for a stranger (should not exist; the list is 404).

## Round 2 (Reviewer LOWs)
- LOW-1: `booking_accepts_receipts` now also requires `grocery_option = 'chef_shops'` (same unpushed migration edited). New RLS test in `tests/rls/receipts.test.ts` (chef of an accepted option A booking cannot upload; the same chef can once it is option B). The existing storage test in `tests/rls/storage.test.ts` used an option A fixture booking, so it now creates its own accepted `chef_shops` booking.
- LOW-2: comment in `src/lib/server/groceries.ts` now says the JSON is parsed first and no field is read before the ownership check. Route order unchanged.
- Contract 7B storage sentence updated.
- Jimmy decided 2026-10-14: shopping list per dish is OK; one current receipt per booking; disputes are resolved via an admin view in WO-5; receipts only while accepted or completed. Open questions 1, 2, 4, 5 above are therefore answered. Still open: A-15 tolerance, and orphan-file cleanup (needs delete approval).
