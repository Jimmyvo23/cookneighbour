# Handoff: T-080 Reload the booking after a 409 from a booking change

From: frontend  To: tester

## What changed
- Branch: `feature/T-080-reload-after-409`
- Pull request: #157
- Files:
  - NEW `src/components/refusal.tsx`: the shared mechanism (context, `useBookingRefusals`, `isStateRefusal`).
  - `src/components/chef/parts.tsx`: `useSection().run` reports a 409 to the page when a page provides the context; otherwise unchanged.
  - `src/components/booking/BookingDetailView.tsx` (customer page) and `ChefBookingView.tsx` (chef page): quiet `refresh`, page-level refusal alert, provider. Customer `CancelSection` has its own error state, so it reports 409 through the same context.
  - Tests: NEW `src/components/booking/Refusal409.test.tsx` (14), NEW `e2e-mock/t080-reload-after-409-mock.spec.ts` (2); one assertion adjusted in `ChefEndSections.tester.test.tsx`.

## Design choice (why)
- Every change section on both pages goes through `useSection` (pickup propose/respond/confirm/missed, accept/decline, cooked/complete, no-show, chef cancel, receipts) except the customer cancel, which has its own state. So one fix lives in two places only: `useSection.run` and the customer cancel catch. No per-section copies.
- On HTTP 409 the section does NOT show its own alert and does NOT move focus. It calls `report(message)` on the page. The page (one owner, lessons section 3 "Focus decided by two components"):
  1. shows the message in ONE `role="alert"` (`data-testid="refusal"`) rendered in `<main>` outside the sections, so it survives when the reload removes the dead button's section (e.g. the missed-pickup block);
  2. focuses it in an effect keyed on a counter (a new element per refusal via `key`, so a repeat is announced and focused again; no focus code runs on mount, so StrictMode's double effect does nothing extra);
  3. calls a quiet `refresh()`: `GET` the booking and `setState(ready)` without the "loading" state (the existing `load()` shows "Loading" and would unmount everything). A failed refresh is swallowed: old page and message stay. `seq` makes a newer load or successful change win over an older refresh.
- One refresh per refusal, triggered from the event handler, not from an effect or from the refresh itself, so no loop.
- The alert is rendered only while there is a message (no empty alert on a clean page). It is cleared when a later change succeeds (`onChange`), not by a refresh.
- 422, 403, 404, network and timeout errors keep today's behaviour (section alert and focus, no refetch). Pages with no provider (chef profile, admin, etc.) are unchanged.
- Mock and real adapters share the path (both go through `apiFetch`/`ApiClientError`).
- Trade-off: the refusal alert is at the top of the page, not next to the button; focus scrolls it into view. Chosen because the section may vanish.
- No backend or contract change.

## How to verify
- `npx vitest run src/components/booking/Refusal409.test.tsx` -> 14 pass (9 of them fail without the fix; checked by stashing the source).
- `npx playwright test --config playwright.mock.config.ts e2e-mock/t080-reload-after-409-mock.spec.ts` -> 2 pass.
- Local: lint clean, typecheck clean, prettier clean, `npx vitest run` 2110 passed + 3 expected-fail (90 files), full mock e2e 264 passed.
- Test data: the unit tests use the seeded MOCK bookings (9103, 9105, 9101). The e2e edits the saved mock state to make the page stale (no fake clock; dates come from the seed, which is relative to Toronto today).

## Known gaps or risks
- TDD note: the first implementation was written before the tests (the test was written right after and shown to fail without the fix).
- Only the customer and chef booking detail pages are covered. Receipts 409 also report to the page, and the page refresh changes `b.status` so the groceries section reloads itself as before; a 409 that leaves the status unchanged does not refetch receipts.
- The `BookingFlow` (create booking) is not a change section and is untouched.
- Impeccable: `detect` on `refusal.tsx` clean. The finish-reviewer helper step was skipped (D-44). Alert styling is copied from the existing `Alert`.
- CONTACT_DETAILS_NOT_ALLOWED is HTTP 422 (src/lib/api/errors.ts), so it keeps the section alert and field highlight.

## What the Tester should try
- Chef: open an accepted past-deadline chef's-home booking in two tabs; customer confirms in one; press "Mark pickup missed" in the stale tab: button gone, alert focused, one alert only.
- Customer: stale confirm after chef marked missed; stale cancel after the chef cancelled; chef stale accept after expiry.
- Offline during a change: section alert, no refetch. Screen reader announces the page alert once. 375 px and dark mode (alert uses the existing red classes).
- Fast double press of the confirm button (busy guard) gives one POST and one refetch.

## Round 2 (Tester MED-1 and LOW-1)
- **MED-1 fixed.** Mechanism: the page's context value is now `{ report, count }` (`RefusalScope` in `src/components/refusal.tsx`). `count` goes up by one per refusal and is never reset (`clear()` only hides the alert). `GroceriesSection` reads it with `useRefusalCount()` and, when it changes, calls its existing quiet `load(true)` once (a ref remembers the last handled count, so mounting or re-rendering never reloads, and the reload itself cannot trigger another). The reload draws no alert and moves no focus, so the page alert stays the one focus owner. A failed reload is already swallowed by `load(true)`, so the old list and the page alert stay.
- Why this and not a callback: no new wiring in the two pages beyond the provider value, no second context, and any future section with its own server data can use the same hook.
- **LOW-1 fixed.** `report` returns early when the page is unmounted (a `mounted` ref), so no setState or reload after unmount. StrictMode safe: the effect sets the ref true again after its simulated cleanup.
- Tests (TDD: the flipped Tester test failed first, "expected 1 to be 2" receipts GETs, and fails again with `GroceriesSection.tsx` stashed):
  - `Refusal409.tester.test.tsx`: MED-1 test flipped (receipts GET +1, buttons gone, alert still focused, no loop after an extra wait; its receipts route is now a function so each GET sees current state); NEW test: failed receipts reload keeps old list and the page alert. 
  - `e2e-mock/t080-reload-after-409-mock.spec.ts`: NEW stale receipt confirm (receipt marked confirmed in the saved mock state behind the open page; mock answers 409 `already_answered`; list reloads, both buttons gone, alert focused, one visible alert). Now 3 tests.
- Local: lint clean, typecheck clean, prettier clean, full unit 2113 passed + 3 expected fail (91 files), full mock e2e 267 passed (includes the Tester's 2 specs).
