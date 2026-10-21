# Handoff: T-052 Accessibility pass

From: frontend  To: tester

## What changed
- Branch: `feature/T-052-accessibility` (from main 6071b11; origin/main merged, no conflicts). PR: see the PR for this branch (title "T-052: Accessibility pass with axe checks").
- New `e2e-mock/t052-a11y-mock.spec.ts` (mock stack, `NEXT_PUBLIC_API_MOCK=1`): axe over every page at 375 px, 1280 px and 375 px in dark mode, in the role each page needs (signed out, customer, chef, admin), plus interactive states (booking form with errors, filled form with estimate, review step, cancel panel, decline panel with error, dish form with errors, admin reject error) and keyboard checks.
- `src/components/SkipLink.tsx` (new) and `src/app/layout.tsx`: "Skip to main content" link as first Tab stop, plus one anchor (`#main-content`) after the account bar.
- `src/components/booking/BookingDetailView.tsx`: "Keep my booking" now returns focus to the "Cancel this booking" button.
- `src/components/refusal.tsx` and `refusal.test.tsx`: T-083 NIT-B fix (see below).
- `e2e-mock/chef-detail-tester.spec.ts`: one more Tab, because the skip link is now the first stop.

## Axe configuration
Tags `wcag2a, wcag2aa, wcag21a, wcag21aa` plus `best-practice` (landmarks, heading order, region, skip-link). No rule disabled, nothing excluded, no `exclude()` selectors.

## Violations found and fixed, per page
The existing pages were already clean under those tags at 375 px, desktop and dark mode (earlier tasks had run axe per page; contrast, labels, button names, landmarks and heading order all passed on /, /search, /chefs/[id], /chefs/[id]/book, /bookings, /bookings/[id], /chef/apply, /chef/availability, /chef/dishes, /chef/bookings, /chef/bookings/[id], /admin, /admin/chefs, /admin/chefs/[id], /admin/bookings, /admin/reports, /admin/free-trial-blocks, /login, /signup, /verify-phone, /address, /allergies). Not covered because it needs a real stack: `/admin/bookings/[id]/chat` (reached only from a real booking link; the mock admin list has the same chat component, covered by the chat specs from T-047/T-049) and live Realtime chat.
Findings that are not axe rule violations, found by keyboard checks:
1. No skip link (flagged in the PLAN.md T-040 notes). Added. Fixed on every page.
2. /bookings/[id], cancel panel: "Keep my booking" removed the focused button and focus fell to the page top. Fixed (focus returns to the opener). The same pattern in the chef decline panel, chef end-of-visit steps and the report form already returned focus.
3. First attempt at the skip link pointed to `#main`, which axe flagged (`skip-link`, `region`: target did not exist). The final target is a single layout anchor, not a per-page id, because earlier pages stay mounted but hidden after in-app navigation (a per-page id could name a hidden copy).

## Keyboard and dialogs
There are no modal dialogs in the app: every panel (cancel, decline, report, dish form, end-of-visit) is inline, so there is no Escape behaviour to add and none was invented. Tested: focus moves into a panel when it opens (heading or first field) and back to the opening button when it closes (cancel, decline); form errors move focus to the first invalid field (login); skip link is the first Tab stop, appears on focus, Enter moves focus to `#main-content`, and the next Tab lands on the first control; it works after in-app navigation.

## T-083 NIT-B (manual screen-reader reasoning; no real screen reader was run)
Markup before: `<div role="alert" data-testid="refusal">sentence + status sentence</div>`. The status sentence ("This page shows its current status." / "Reload the page to see its status.") is added after the reload by changing the text of the same element. `role="alert"` implies `aria-live="assertive"` and `aria-atomic="true"`. With atomic true, a change anywhere inside makes the screen reader read the WHOLE region again, so the user hears the sentence, then the sentence and the status sentence: a double reading.
Fix: `aria-atomic="false"` on the alert, and the status sentence is now its own child `<span data-testid="refusal-status">` added later. A non-atomic live region announces only the added node, so the status sentence is read once, alone, and the first sentence is not repeated. The element keeps `role="alert"`, the same key (a new refusal is still a new element and is announced; the status arrival is not), the same `data-testid`, same focus owner, and the same `textContent`, so existing tests are unchanged. New unit test in `refusal.test.tsx` proves: role alert, `aria-atomic="false"`, text is the sentence alone while the reload runs, same DOM element after it finishes, status in a separate child. Residual: focus also moves to the alert on first show, and some screen readers (NVDA with Firefox) read a focused container once more; that is one reading on focus, not a repeat from the live region, and was the intended T-083 behaviour. Please run a real VoiceOver or NVDA check if Jimmy wants proof.

## How to verify
- `npm run lint`, `npm run typecheck`, `npx prettier --check .`: clean.
- `npx vitest run`: 2979 passed, 3 expected fails.
- `npm run test:e2e:mock`: 356 passed after the one-Tab fix in chef-detail-tester (first full run had 1 failure from exactly that); new spec: `npx playwright test --config playwright.mock.config.ts t052-a11y` (39 tests).
- Confirmed the "Keep my booking" keyboard test fails without the fix.
- `impeccable detect` on SkipLink.tsx and layout.tsx: no findings.

## Known gaps or risks
- No real screen reader run (reasoning only for NIT-B).
- Axe cannot judge reading order, link purpose or the copy; only the mock stack is covered (hosted/real pages share the same components).
- Real-stack e2e (`e2e/`) not run locally (no Docker); no Tab-count test there is affected.
- `/admin/bookings/[id]/chat` page itself not covered by axe (see above).

## Builder choices (unconfirmed by Jimmy)
- New visible text: "Skip to main content", seen only while the link has keyboard focus (small bordered box at top left).
- Added `best-practice` axe tag on top of WCAG A/AA, a stricter bar than asked.
- Added a dark-mode 375 px axe run.
- Skip link target is an empty anchor after the account bar, not the `<main>`.

## What the next agent needs
- Tester: try the skip link in Safari/Firefox if available; check that nothing else assumed the first Tab stop is the account bar.
- Open item: T-069 Impeccable audit/polish can reuse the new spec as its accessibility baseline.
