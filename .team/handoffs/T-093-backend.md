# Handoff: T-093 + T-095 Invisible-only names and addresses, T-060 follow-ups

From: backend  To: tester

## What changed
- Branch: `feature/T-093-text-followups` (PR link in the Planner report)
- T-093: new `hasNoVisibleText` and `NO_VISIBLE_TEXT` ("Enter at least one visible character.") in `src/lib/domain/text-fold.ts` (fold, then trim, then empty?). Used on display name (`Fields.visibleText` in sign-up and `PATCH /api/me`, `displayNameProblem` in the browser), own address line/city (`PUT /api/me/address`, `validateAddress`), booking address (`parseBookingBody`, `localProblems`), chef kitchen address (`parseKitchenAddress`), admin `reviewedAddress` (`parseKitchenReview`), dish name (`parseDishBody`). Bio, notes, chat, reviews, reasons unchanged.
- T-095: `addressKey` folds before lowercasing; browser `validateAddress` runs `hasUnsafeText`; regex classes in `text-fold.ts` written as `\u` escapes; `parseKitchenReview` address branch tidied (no empty branch).
- Contract `docs/api-contract.md` bumped to v1.21 (status line and section 1 paragraph).
- Files: `src/lib/domain/{text-fold,address,admin-chefs,bookingRequest,chef-application,dishes}.ts`, `src/lib/api/validate.ts`, `src/lib/validation/auth.ts`, `src/lib/booking/form.ts`, `src/app/api/{auth/signup,me,me/address}/route.ts`, tests `src/lib/domain/text-visible.test.ts` (new) and `text-fold-tester.test.ts` (F7 characterisation flipped: joiner-only dish name now refused), the contract.

## How to verify
`npx vitest run` (2937 pass), `npm run lint`, `npx prettier --check .`, `node --experimental-strip-types -e "import('./src/lib/domain/hash.ts')"` (loads). API/RLS tests run in CI. Local `tsc` only shows the missing Next generated `PageProps`/`LayoutProps` types (worktree has no `.next`), nothing from this change.

## Known gaps or risks
- Old stored `address_hash` keys of addresses with look-alike letters (for example "ℌ") stay until the address is saved again; no migration (same as D-135).
- A value of only ordinary spaces (or NBSP/ideographic space) is emptied by the trim first, so it keeps the length message ("Enter 1 to N characters."), not the new text. Both are refused.

## What the next agent needs
Builder choices beyond the WO (unconfirmed by Jimmy):
1. The rule is also applied to the booking address and the admin `reviewedAddress` (both are address line/city), and the browser booking form.
2. Error text "Enter at least one visible character." chosen by the builder.
3. Browser `validateAddress` now gives "Remove control or invalid characters." for unsafe characters, same as the server.
4. Added `Fields.visibleText` (server) instead of changing `Fields.text`.
Test idea: joiner-only, `　`-only values on each field; joined emoji, ZWNJ Persian, Vietnamese, CJK still accepted.
