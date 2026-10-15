# Handoff: T-067 Saved allergy profile, frontend part (Tester)

From: tester  To: reviewer

## FINAL RESULT (round 2): PASS. T67-T1 is fixed and verified.

Head tested: ffeb014 plus my test-only commit (SHA in the report and PR).

## Checks run
- `npm run lint` clean, `npm run typecheck` clean, `npx prettier --check .` clean.
- `npx vitest run`: 81 files, 2002 pass, 3 expected fail (unchanged).
- Mock e2e (port 3267 because 3101 was held by another worktree): 232 pass. The one failure, `search-t040-tester-mock` "map never asks any server", hardcodes port 3101 and only fails on another port. Not a regression (builder's run on 3101 passed).
- API test `tests/api/saved-intake.test.ts` needs Docker: CI only.

## Verified (all pass)
- /allergies: view, save, reload, update, delete with confirmation (Keep it returns focus to the Delete button), blank form refused (two errors in summary, focus on summary), control characters refused with the message both in the summary and next to the question, nothing saved after a refusal. Chef and admin are redirected; a logged-out visitor goes to /login.
- Booking form: prefilled only from an untouched form; save-back choice absent while answers equal the profile, shown unticked when they differ; ticked replaces the profile, unticked leaves it; first booking with no profile can save.
- Failed profile save after booking: tested with a test-only browser script (wraps sessionStorage reads; first read after the booking is stored answers as a chef so the PUT gets 403). The booking is kept, URL ends `?sent=1&profile=notsaved`, notice `profile-not-saved` shows, axe clean, nothing saved.
- Mock adapter routes and log out: the profile is gone after log out and a new sign-up sees "Nothing is saved yet".
- DELETE order: code order is session, role, content type. The builder's API test (anon + text/plain = 401, chef + text/plain = 403) is correct. I added the missing third step: customer + text/plain = 400 and the saved profile is not cleared (CI only, could not run here).
- Privacy wording: says only that chefs see answers sent with a request, the profile is not shown to chefs, sent requests keep their answers. Nothing about admin (Q-38). All true to the code.
- Accessibility: axe clean on the page (saved, error, delete-confirm states) and the booking form with the save choice; 375px no sideways scroll on both pages.

## Findings
1. LOW, bug T67-T1: "Book another visit with this chef" refills from the profile snapshot loaded when the page opened (`savedRef`), and the `saved` state is not updated after the post-booking PUT. Repro: save a profile (Mustard), open the booking form, change the note to "Sesame too", tick "Replace my saved allergy profile", send. Press "Book another visit": the form shows Mustard with an empty note (old profile) instead of "Sesame too", and the save choice then offers to replace the profile again. The server profile is correct (Sesame too). Fix: after a successful PUT set `savedRef.current` and `saved` to its response. Test: `e2e-mock/allergy-profile-tester-mock.spec.ts`, "Book another visit button refills from the profile just saved" is marked `test.fail()`; it turns red when fixed, then delete that line.
2. INFO: the allergy error is attached to the question group (fieldset), not the textarea, so the textarea has no `aria-invalid`. Axe passes; no change asked.
3. INFO not tested: typing before the profile loads (the mock answers too fast to race reliably); covered by unit tests of `intakeIsUntouched` only. GET failure hiding the save choice also not exercised.

## Tests added
- `e2e-mock/allergy-profile-tester-mock.spec.ts` (8 tests): failed-save notice, new booking after an unsaved edit, Book another visit (test.fail, finding 1), control-character refusal, blank refusal, forgotten on log out, admin redirect, 375px with saved profile and delete confirmation.
- `tests/api/saved-intake.test.ts`: customer + wrong content type = 400 and profile kept.


## Round 2 (final)
Head tested: 596c6b7 plus my test-only commit (see PR for the final SHA).
- T67-T1 confirmed fixed. With `BookingFlow.tsx` temporarily reverted to 596c6b7^ (not committed), the "Book another visit" test fails (shows the old profile, not "Sesame too"); with the fix it passes. The spec now holds the sent state with a never-answered route and no `test.fail()`.
- Click-timing: new test "Book another visit still works when the profile save fails" (failed PUT, forced with the test-only script): the button shows the form again within 5 s and refills from the old profile. A failed PUT does not block it.
- INFO, not a bug I can show in MOCK: `apiFetch` has no timeout, so a PUT that never answers would make the button (and the `router.push`) wait until the browser fails the request, which then rejects and is caught. Before the change the button worked at once in that case; now it waits. Real network hangs end with a browser error, so I rate this INFO. Could not simulate a hang in MOCK mode (the adapter does not use the network).
- All earlier coverage (list in "Verified" above) stays green on this head. Lint, typecheck, prettier clean; unit 81 files, 2002 pass + 3 expected fail; mock e2e 234 pass (port 3101 free this time). API test needs Docker: CI only.
