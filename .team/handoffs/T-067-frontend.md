# Handoff: T-067 Saved allergy profile (frontend part)

From: frontend  To: tester

## What changed
- Branch: `feature/T-067-allergy-profile-ui` (from main 425c751). Pull request: "Closes #119" (number in the Planner's report).
- New page `/allergies` ("My allergy profile", customer only; server guard `requireCustomerPage` plus client `redirectFor`): view, save, update, delete (two-step delete). Link "Allergy profile" in the account bar for customers.
- Booking form: loads `GET /api/me/intake`; fills the five answers only if the customer has typed nothing yet; note "Filled in from your saved allergy profile" with the save date; a checkbox (unticked) "Replace my saved allergy profile..." / "Save these answers to my allergy profile for next time", shown only when the answers differ from the saved profile. The PUT runs after a successful create; if it fails the booking stays sent and the booking page shows a notice (`?sent=1&profile=notsaved`). "Book another visit" re-fills from the profile.
- Shared `IntakeFields` component (both screens ask the same questions); `intakeProblems` extracted from `localProblems` in `form.ts`.
- Mock adapter: `GET/PUT/DELETE /api/me/intake` (real `parseSavedIntake`, customers only, forgotten on log out).
- Review carry-ins: DELETE now checks session, role, then content type (contract 4A states the order; API test added); the "Extra texts..." comment moved back above `EXTRA_REASONS`.
- Files: `src/app/allergies/page.tsx`, `src/components/booking/{SavedIntakeView,IntakeFields,BookingFlow,BookingDetailView}.tsx`, `src/components/AccountBar.tsx`, `src/lib/booking/{savedIntake,form,changes}.ts`, `src/lib/mocks/mock-adapter.ts`, `src/lib/auth/route-guard.ts`, `src/app/api/me/intake/route.ts` (order swap only), `docs/api-contract.md` (one sentence), tests: `src/lib/booking/savedIntake.test.ts`, `src/lib/mocks/mock-saved-intake.test.ts`, `src/components/booking/SavedIntakeView.test.tsx`, route-guard test, `tests/api/saved-intake.test.ts` (check order, CI only), `e2e-mock/allergy-profile-mock.spec.ts`.

## How to verify
- `npm run lint`, `npm run typecheck`, `npx prettier --check .`, `npx vitest run` (81 files, 2002 pass, 3 expected fail), `npm run test:e2e:mock` (225 pass). The API test needs Docker and runs in CI only.
- Impeccable `detect` on the new page and components: no findings. Impeccable helper agents skipped (D-44).

## Known gaps or risks
- No test for the "profile save failed after booking" path (the mock cannot fail a PUT on demand); the code path is small and the notice is in `BookingDetailView`.
- If `GET /api/me/intake` fails in the booking form, the save choice is hidden and the form works as before.
- The late-loading profile never overwrites answers the customer already typed (by design).
- Privacy wording says only: a chef sees only the answers sent with a request, the profile is not shown to chefs, bookings keep their own copy. Nothing about admin (Q-38). A test blocks the words admin, private, secret, confidential on the page.
- Lessons-learned section 3 checklist: server-side validation reused (no new server code); focus after errors tested; ids scoped with FieldScopeProvider; MOCK badge unchanged; no storage URLs.

## What the next agent needs
Test ideas: type in the form before the profile loads; save with the box ticked then change the profile page; two tabs; phone width 375; chef or admin visiting `/allergies`.

## Round 2

Fixed bug T67-T1 (LOW), "Book another visit with this chef" refilled from the page-open profile.

- `src/components/booking/BookingFlow.tsx`: after the post-booking `PUT /api/me/intake` succeeds, `savedRef.current` and `saved` are set from its response. The PUT promise is kept in `profilePutRef`, and the "Book another visit" button awaits it, so a click while the save is still running refills from the new profile.
- `e2e-mock/allergy-profile-tester-mock.spec.ts`: removed `test.fail()`. The test held the sent state by aborting the navigation request, but Next then falls back to a hard navigation that also fails and leaves an error page. Changed it to a request that never answers (`page.route(..., () => {})`), which keeps the sent state on screen. Test code only.
- Impeccable finish-reviewer/documenter steps skipped (D-44). No visual change.
- Results: prettier, lint, typecheck clean; unit 2002 passed plus 3 expected fail (81 files); mock e2e 233 passed.
