# Handoff: T-088 Narrower phone rule

From: backend  To: tester

## What changed
- Branch: `feature/T-088-phone-rule`
- Pull request: see PR titled "T-088: Narrower phone rule" (Closes #182)
- Files: `src/lib/domain/contactDetails.ts` (rule), `contactDetails-t088.test.ts` (new), `contactDetails.test.ts` and `contactDetails-tester.test.ts` (old 7-digit cases moved to "passes"; the 10.5.2026 false-positive pin removed), `docs/api-contract.md`, `docs/domain-rules.md`, `docs/work-orders/WO-6a-backend-hardening.md`.
- Same module is used by client and server (mocks, bookings, reviews, messages, bookingChanges); no caller changed.

## How to verify
`npm run lint && npm run typecheck && npx vitest run` (2362 passed, 3 expected fail).

## Known gaps or risks
Builder choices, NOT confirmed by Jimmy:
1. 12+ digits contiguous pass; but a 3-3-4 phone shape inside a longer spaced run is refused (`ref 12345 416 555 0199`, `12345 416 555 0199`). Contiguous 12+ digits with an embedded 10-digit shape are not refused.
2. Two numbers split by text are judged separately: `416 555 or 0199` passes; `416 555 0199 or 647 555 0100` refused.
3. Extension: `416 555 0199 ext 5` refused; `555-0199 ext 5` passes.
4. Non-North-American numbers (`+44 20 7946 0958`, 12 digits) pass; 11 digits not starting with 1 pass.
5. Dotted dates (`10.5.2026`) now pass. Spaced single digits `9 0 5 5 5 5 0 1 2 3` still refused (10 digits with spaces).
6. Side effect: a 10-digit run with spaces such as `1 2 3 4 5 6 7 8 9 10` (11 starting 1) is refused.
Tests were written with the code in one step; the new file was not seen failing first.

## What the next agent needs
Try odd separators, NBSP, letters mixed in, multi-line phones (not handled, runs are cut by letters).
