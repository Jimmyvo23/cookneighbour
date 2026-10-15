APPROVE (T-067 frontend part, saved allergy profile UI, head 5a9f4a7)

Reviewed against the PLAN.md T-067 row, D-38, Q-38, docs/lessons-learned.md, and the handoffs `.team/handoffs/T-067-frontend.md` (rounds 1 and 2), `.team/handoffs/T-067-tester-frontend.md` (PASS) and the earlier T-067 backend, tester and reviewer handoffs.

## Checks I ran
- `npm run lint`, `npm run typecheck` and `npx prettier --check .` are clean.
- `npx vitest run`: 81 files, 2002 passed, 3 expected fail.
- CI run 38791668932 on 5a9f4a7 is green. The API job ran `tests/api/saved-intake.test.ts` (5 tests, including the new 401/403/400 order test) and `saved-intake-tester.test.ts` (8 tests).
- I did not run mock e2e myself. The Tester ran it on this head: 234 pass.

## Correctness: OK
- Prefill: `GET /api/me/intake` loads once, only for customers. It fills the five answers only through `intakeIsUntouched(d)` inside the `setDraft` updater, so a profile that arrives late never overwrites typed answers. `draftFromSaved` always leaves the conflict tick unticked, which is right: D-24 and D-38 still need a fresh acknowledgement for each booking.
- Save-back opt-in: the box starts unticked. It shows only when the answers differ from the profile (`sameIntake` ignores case, order and outer spaces) and stays hidden while the GET is pending or failed. The wording ("Replace..." or "Save... for next time") matches what happens.
- Post-booking PUT: it runs only after a successful create, so it never blocks or rolls back a booking. If it fails, the page goes to `?sent=1&profile=notsaved`, and `BookingDetailView` shows a `role="status"` notice with a link to `/allergies`. This matches the contract 4A decision that `create_booking` stays untouched.
- T67-T1 fix: after a successful PUT, `savedRef` and `saved` take the PUT response. "Book another visit" awaits `profilePutRef.current`. That promise is wrapped in `.catch(() => {})`, so a failed PUT cannot throw in the click handler. The handler also resets `saveToProfile`. The Tester proved the regression test goes red without the fix and green with it, and added a test where the PUT fails.

## Privacy: OK
- The page and checkbox wording claim only things the code enforces. Chefs see only the answers sent with a request. The saved profile is not shown to chefs: the routes are customer-only and no chef read path exists. Sent requests keep their own copy in `intake_forms`.
- The wording says nothing about admin (Q-38 stays open). A unit test blocks the words private, secret, nobody, no one, admin and confidential.
- Data is kept minimal. DELETE clears the profile. The mock forgets the profile on log out.

## Security: OK
- `/allergies` has the server guard `requireCustomerPage()` plus `isCustomerPage` in the client route guard, with a unit test. The account bar shows the link only to customers.
- The API routes were already customer-only. The user id comes from the session, never from the body. The mock adapter returns 403 for non-customers and uses the real `parseSavedIntake`.

## DELETE check order and contract sentence: OK, in scope
- `route.ts` DELETE now runs `requireCustomer()` (401 then 403) before `requireJson` (400). PUT already had this order because `readJsonObject` calls `requireJson` after `requireCustomer`. The added contract sentence is accurate. The API test covers all three steps and checks that the profile survives a 400.
- This is exactly the LOW carry-in the T-067 backend review asked for, and the PLAN row lists it, as it does the `changes.ts` comment move. It stays within the Work Order. The diff is mostly new UI plus tests, and no new areas are touched.

## Accessibility: OK, with one LOW
- The shared `IntakeFields` keeps the scoped ids (`useDomId`, `FieldScopeProvider` with a per-instance prefix). After an error, focus goes to the failure alert, otherwise to the error summary, with one owner per attempt. "Keep it" returns focus to the Delete button. The Tester ran axe on all states and found no issues, and found no sideways scroll at 375px.
- **LOW (follow-up, not blocking):** `SavedIntakeView.tsx` renders the "Delete saved profile" button only while `!confirming`. Activating it removes the focused button, so focus drops to `<body>`, and screen readers get no announcement for the confirm group (`role="group"` is not live). After a successful delete, "Yes, delete it" is removed too, and focus again lands on `<body>`. The live-region notice is announced in that case. Fix: move focus to the confirm group (or its question text, with `tabIndex={-1}`) when it opens, and to the saved-state line or heading after the delete.
- **NIT:** if the customer ticks the save box and then edits the answers back to equal the profile, the box hides but stays ticked, so an identical PUT runs and only `savedAt` changes. This is harmless. Optionally clear `saveToProfile` when the box hides.
- **NIT:** the contract says "all three handlers" share the check order, but GET has no content-type check. Possible wording: "...then content type (400, PUT and DELETE)".

## Honesty about mocks and scope: OK
- No new money, identity or SMS features. Existing MOCK badges are unchanged. Mock e2e specs call `blockStorage` and use `dayPlus`, as lessons-learned asks.

## Recommendations on the Tester INFO items
1. `apiFetch` has no timeout (a hung PUT delays "Book another visit" and the redirect). Accept for this PR. A real hang ends in a browser network error, which the code catches, and the booking itself is already saved. If wanted, add a request timeout (AbortSignal.timeout) in `src/lib/api/client.ts` as its own small follow-up task, because it affects every call. It should not be patched only here.
2. `aria-invalid` is on neither the fieldset nor the textarea. The error is linked to the question group through `aria-describedby`. This markup is moved unchanged from main, axe passes, and `aria-invalid` is not a supported attribute on a fieldset or group. Keep it as is. Revisit only if a screen-reader audit asks for it. Wiring the error into the textarea too would make it read twice.

Verdict: APPROVE. Merge under D-42 once `ci` is green after `gh pr update-branch`. Track the LOW focus item as a follow-up.
