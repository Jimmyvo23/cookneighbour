APPROVE

# T-080 Reviewer verdict (PR #157, head 3be7dcd)

Reviewed: `gh pr diff 157`, PLAN.md row T-080, `.team/handoffs/T-080-frontend.md` (incl. Round 2), `.team/handoffs/T-080-tester.md` (incl. Re-check), `docs/lessons-learned.md`.

Nothing blocks the merge. The change does what the T-080 row asks: one shared mechanism (`src/components/refusal.tsx`), hooked in two places only (`useSection().run` and the customer `CancelSection`). There is one page-level `role="alert"` that owns focus. The booking refetch is quiet, and a refusal counter reloads the receipts. 422, 403, 404 and network errors keep the old per-section path. Pages with no provider (chef application, admin) are unchanged. No backend, migration or `docs/api-contract.md` change. Scope matches the PLAN row; Round 2 (receipts reload) is inside it, not scope creep.

## Findings

- **LOW-1: the UI text tells the user to do what the page already did.** `src/lib/booking/changes.ts:51,59,72,87` and `src/components/booking/BookingDetailView.tsx:84`. Each 409 message ends in "Reload the page to see its status." The page now reloads by itself, and the refreshed status shows right under the alert. The text is not false (it is still useful when the quiet refetch fails), but it is now mostly redundant. Suggest a follow-up wording pass, for example "The page now shows its current status."
- **LOW-2: some test data is a state the API never sends (lessons §3, "Tests fed data the API never sends").**
  - `src/components/booking/Refusal409.test.tsx:266-270`: the refetched booking is `status: "no_show_customer"` with `noShow: b.noShow`, and `noShow` is null on the seeded accepted booking. `types.ts:708` says `noShow` is set for every `no_show_*`.
  - Same file, `:304` `{ ...b, status: "cancelled" }` (with `cancelledBy` and `cancelledAt` null) and `:329` `status: "expired"`.
  - Same in `e2e-mock/t080-reload-after-409-mock.spec.ts:93` (`d.status = "no_show_customer"` only).

  The assertions are about the button going away and the alert keeping focus, so they still prove T-080. A render bug that only shows with a real `noShow` or cancellation block would slip through, though. Prefer building the "later" state with the mock adapter's own transition, or set the matching fields.
- **LOW-3: a page refusal is not cleared by a later success in a section that has no `onChange`.** `src/components/refusal.tsx:91`, `src/components/booking/GroceriesSection.tsx`. Example: after a receipt 409 the top alert stays, and a later successful receipt upload shows its own notice while the old refusal is still at the top. This is harmless (the text is still true about the earlier attempt), but the page then shows two messages. Optional: have `useSection` call a context `clear` on success. Fine as a follow-up.
- **NIT-1:** `src/components/refusal.tsx:3` says "(HTTP 409 INVALID_STATE)", but `isStateRefusal` matches every 409 (REQUEST_EXPIRED, DOUBLE_BOOKED, ...). That is the right behaviour (each one means the booking changed under the page), so fix the comment, not the code.
- **NIT-2:** `src/components/refusal.tsx:36` says "a section never reloads just for mounting". A section that mounts after a refusal starts with `seenRefusals = 0` (`GroceriesSection.tsx:148`) and does one extra quiet reload. Today `GroceriesSection` is always mounted, so this cannot happen. Comment accuracy only.
- **NIT-3:** `e2e-mock/t080-reload-after-409-mock.spec.ts:36`: the comment names the MOCK hook `pickedUpSeeded`, but the test uses `editBooking`. The comment is stale.
- **NIT-4:** the 422 tests use code `"VALIDATION_ERROR"` (`Refusal409.test.tsx:186`, `Refusal409.upload.tester.test.tsx:107`). The real code is `VALIDATION_FAILED`. Behaviour depends only on the status, so the test is still valid. Copy the real code anyway.
- **INFO-1: correctness.**
  - **Races:** `seq` is shared by `load`, `refresh` and `onChange`, so the newest wins (the Tester's race test pins this). The receipts reload uses its own `seq`.
  - **No loop:** a refresh never reports, and the receipts effect is guarded by a ref.
  - **Stable callbacks:** `report` is stable (empty deps, `reloadRef`), so there is no stale closure.
  - **StrictMode:** focus runs only when `last` changes, and the `mounted` ref is set again after the simulated cleanup. Tested.
  - **Unmount:** `report` returns early once the page is unmounted.
  - **Busy flag:** the `finally` still resets `busy` on the early return.
- **INFO-2: accessibility.**
  - **One focus owner:** the section skips `fail()` (no tick), so only the page moves focus (lessons §3).
  - **Placement:** the alert sits in `<main>` above the `Ready` content and outside the section that may vanish.
  - **Repeat refusal:** `key={last.id}` creates a new element, so screen readers announce it again. Tested.
  - **Consistency:** `tabIndex=-1` plus focus, same as the existing `Alert`.
  - **Checks:** axe is clean at 375 px in light and dark.
  - **Trade-off:** the alert is at the top of the page, not next to the button. The handoff declares this, and it is acceptable.
- **INFO-3: test quality and the round-1 TDD slip.** I checked that the tests fail without the fix, in a scratch copy with the four source files restored from `main`:
  - 15 of 20 T-080 unit tests fail.
  - The 5 that pass are the intended 422/403/404/network guards.
  - With only `GroceriesSection.tsx` reverted, the 4 receipts-reload tests fail.

  Coverage now spans every change path the Tester audited:
  - chef: pickup missed, respond, accept;
  - customer: pickup confirm, cancel;
  - receipts: answer and upload;
  - failed refetch, race, StrictMode, no-loop, and success-clears.

  The slip is declared, and the behaviour is now covered.
- **INFO-4: code style** matches the surrounding code (the `seq` pattern, the eslint-disable comments, the `Alert` classes copied with the reason noted). The two `refresh` callbacks are duplicated across the two pages, just like the existing `load`. Acceptable.

## Verification (run by Reviewer on 3be7dcd)
- `npm run lint` clean, `tsc --noEmit` clean, prettier clean on the changed files.
- `npx vitest run`: 92 files, 2116 passed + 3 expected fail.
- Mock e2e, both T-080 specs: 5 passed.
- CI `ci` run 39065035763 on 3be7dcd: **success** (lint, typecheck, unit, build, RLS, API, seed, real e2e, mock e2e). The earlier runs 39064715609 and 39063503183 were cancelled because newer pushes replaced them.

LOW-1 to LOW-3 and the NITs can go into a follow-up task. None needs another round before merge.
