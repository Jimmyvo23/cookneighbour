# Handoff: T-044 Grocery options API

From: tester  To: reviewer

## Verdict: PASS (0 bugs found)

## What changed
- Branch: `feature/T-044-grocery-options`; PR #110 (issue #32). No app code changed.
- Tests added (all run and pass):
  - `src/lib/domain/t044-tester.test.ts` (51 unit tests): A-15 at exactly the tolerance and one cent over, above and below, for estimates 0, 1, 2500, 3333, 3334, 3349, 3350 (half-up rounding to 503), 3351, 8000, 10001, 10003, 10004, 200000; snapshot is the only input; no markup and MOCK wording; shopping list equals `estimateBooking` ingredients per day and in total; `days[].labourCents` is 0 under the free trial (waived amount only in totals); path/body/answer edge cases; contract v1.6 vs routes, methods, `types.ts` exports, `ReceiptView` fields, reason codes, migration file.
  - `tests/api/groceries-tester.test.ts` (30 API tests, CI): A-15 boundaries through the API for estimates 10000, 2500 and 3350 (rounding); flag uses the booking snapshot even after the dish price changes; reimbursement equals the receipt amount, only after confirm, `mock:true, collected:false`, none when disputed; access (anonymous, admin, chef, other chef, other customer, customer on submit) on respond/list/shopping; receipt id of another booking is 404; path rules (leading slash, backslash, `//`, dot segments, wrong/double extension, unicode, long name, empty, missing object, pdf/jpg/jpeg accepted, path of another booking); option A gets `not_chef_shops`; cancelled booking is `wrong_status` for submit and answer; completed booking accepts; confirm twice and dispute-after-confirm are `already_answered`; dispute, replace, old superseded (`receipt_superseded`, no file link, list order); double submit races (different files and the same file: one 201, one 409); notifications hold no amounts, address or phone.
  - `tests/rls/receipts-tester.test.ts` (2 RLS tests, CI): parties and admin can read/sign a receipt object; other chef, other customer and anonymous cannot read, sign, list or upload; the customer cannot upload; public URL does not work; a chef cannot upload into another booking's folder or made-up folders.

## How to verify
- Local: `npm run lint`, `npm run typecheck`, `npm test`: pass (64 files, 1709 passed, 3 expected fail, same as main).
- CI (run on the pushed branch, `gh pr checks 110`: pass). The CI log shows these files ran: `tests/api/groceries.test.ts` (20), `tests/api/groceries-tester.test.ts` (30), `tests/rls/receipts.test.ts` (7), `tests/rls/receipts-tester.test.ts` (2), unit `groceries.test.ts` (33).

## Checks against the brief
- Section 10 mismatch (A-15): correct at all boundaries, both directions, integer cents, against `est_ingredients_cents`. PASS.
- No markup, MOCK, nothing collected: PASS.
- Access and RLS (receipts table and bucket): PASS. Note admin can read receipt objects (by design in the earlier storage policy; contract says parties and admin).
- Flow and races: PASS.
- Contract v1.6 / `types.ts` / `days[].labourCents` wording: PASS.

## Known gaps or risks (not bugs)
- Not tested (no Docker, and not reachable from the API): raw SQL calls of `submit_receipt` and `answer_receipt` with bad inputs beyond what CI covers.
- A-15 tolerance, per-dish (not per-ingredient) shopping list, one receipt at a time, unresolved disputes, and receipt only while accepted/completed remain open questions for Jimmy (builder's Q-T044-1 and list). Observation: a customer who has confirmed cannot change their mind (final by design).
- Orphan uploaded files cannot be cleaned by clients (deleting needs Jimmy's approval).
- The migration is not pushed to hosted; Jimmy runs `npx supabase db push --linked` after merge.

## What the next agent needs
- Reviewer: check the open questions above and the MOCK wording in the UI task T-045. No bugs to fix.
