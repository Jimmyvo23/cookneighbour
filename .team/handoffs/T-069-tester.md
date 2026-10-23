# Handoff: T-069 Visual design pass "Grandma's table" (tester round 1)

From: tester  To: frontend

Verdict: BLOCK (one Medium finding: keyboard focus order on /search; small fix). Everything else passes.

## What changed
- Branch: `feature/T-069-grandmas-table`, head 26288ed9874257c6ed62e25c8559033b859acda4. Pull request 233, issue 232.
- Tester changed no files. Probe specs I used live outside the repo in the session scratchpad (`.../scratchpad/tst/`), not committed.

## How I verified (results)
- e2e-mock, `--retries=0`: run 1 376 passed (6.3 min), run 2 376 passed (6.3 min). A third run with `--workers=6` (stress): 375 passed, 1 failed: `t049-admin-engagement-mock.spec.ts:24` `document-title` axe finding. Cause is the known T-116 title-streaming race in `helpers.ts expectNoAxeViolations` (no wait for the title). It is NOT from the new motion: the same test run 12 times at 6 workers fails 3/12 on this branch and 2/12 on a clean `origin/main` snapshot. Pre-existing flake. `t052`, `chef-detail-tester`, `search-mock` repeated 3 times each: 198 passed. I could not reproduce the builder's 3 failures; none involved motion (no animation or transition touches layout or opacity of tested elements; card entrance is transform only).
- vitest 3240 passed (3 expected fail), lint 0 problems, typecheck ok, `next build` ok. Built output: 6 self-hosted woff2 files, no `fonts.gstatic` or `fonts.googleapis` string in `.next/static` or the server app output.
- Test edit `e2e-mock/chef-detail-tester.spec.ts`: only one added `await page.keyboard.press("Tab")` and a comment. Assertions unchanged. Pure order change, correct (the header name is now a link).
- Extra axe probe (tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice) at 1280 light, 1280 dark, 375 light, 375 dark over: /, /login, /signup, a 404, /search results, chef detail, /bookings, two booking pages, /allergies, booking form, /chef/bookings, chef booking, /chef/dishes, /chef/availability, 4 admin pages: 0 violations in all four modes.
- Sideways scroll at 375 and 1280: none on any page. Decorative SVGs: every `svg` is under `aria-hidden` (no ids inside Ornaments, so no duplicate-id risk). No new text in images.
- Focus ring: tabbed through up to 80 stops per page (5 to 34 stops each); every focused control had an outline of 2 px or more or a box shadow. Screenshots of focused text input, select, radio, checkbox, submit button, summary, link in light and dark: ring clearly visible, not clipped.
- Reduced motion (`reducedMotion: reduce`): 0 running animations and 0 elements with an animation on /, /search, /login, chef page, 404, search results. Card hover lift is off (transform none). Without it: 11 infinite animations on / and /search (see L1).
- Network: only requests to localhost plus the OpenStreetMap tiles of the search map (existing, mocked in tests). No font or other third-party requests. No inline event handlers or `style=` attributes in `src` (grep), so the CSP needs no change.
- Contrast over gingham, ribbons, chips, pills, badges (996 samples, text colour vs the lightest and darkest 2% of background pixels under the text glyph boxes, light and dark, 375 and 1280): all pass AA except L2 below. The other apparent failures were measurement artifacts (dashed stamp border, text range spanning a MOCK badge); I checked them by hand against the builder's token ratios.
- No-copy-change diff (script comparing string literals, JSX text, role, aria, id, htmlFor, name, type, href, handlers per file): only expected differences. New text: the 404 page (This page could not be found, The link may be wrong, or the page has moved., Find a home cook), the error page (Something went wrong, Please try again., Try again), the header name link "CookNeighbour", and the tagline "Home-cooked food from your own culture, made by a neighbour." on / and /search. Removed text: the " · " and ", " separators (replaced by separate elements; cuisine commas kept as sr-only ", "), the plain "not listed" now comes from `CuisineChips`. No MOCK label, `data-testid`, role, label or id removed or weakened (MockBadge keeps its testid and the warning glyph). No form, field or handler logic changed (SearchView onChange only re-indented). Estimate and receipt strings identical.
- Honesty: status pills carry the full words ("Waiting for the chef to answer", "Accepted by the chef", "You accepted this booking"); tint only helps. Chips and allergen box are words. MOCK payment notice, MOCK check badges, "Nothing was inspected for real" all intact. Nothing suggests real verification.
- Visual check: looked at /, /search (375 light, 1280 dark), chef detail (1280 dark), booking review (1280 light), /allergies, chef dish form, admin chef review (1280 dark), /bookings (1280 dark), chef bookings (375), home 375, plus builder shots for the rest. Nothing overlapping, cut off or unreadable. Minor cosmetics in L6.

## Findings

### Medium (blocks)
M1. Focus order does not match visual order on /search below 1024 px (WCAG 2.4.3 Focus Order, Level A; also reading order for screen readers). `src/components/search/SearchView.tsx:454-457`: the Find chefs button's wrapper `div` is in the DOM right after "The food" and before the radios, language, allergens and "Price and date" fieldsets, and `order-last lg:order-none` only moves it visually to the end on a phone. Measured Tab sequence at 375 px: postal code (y 813) > cuisine (y 1141) > Find chefs (y 2925, bottom of the form) > language (y 1384) > ... so focus jumps down to the button and back up. Also changes the Tab order against main for everyone: the button now comes before the filters. Suggested fix: put the button wrapper last in the DOM (after "Price and date") and place it in the hero row on wide screens with grid placement (`lg:row-start-1 lg:col-start-3` or similar) instead of `order`. Add a test that Find chefs is the first Tab stop after the last filter at 375 px.

### Low
L1. `src/app/globals.css` (steam, float, twinkle keyframes; `Ornaments.tsx`): 11 infinite animations play on / and /search for more than 5 seconds with no pause control (WCAG 2.2.2 Pause, Stop, Hide, Level A, if the Reviewer reads decorative loops as in scope). They stop under `prefers-reduced-motion`. Options: finite iteration count (for example 3), or a pause control. Jimmy's call.
L2. `.hero p` tagline at 375 px light (20 px italic, so not "large text"): 4.46:1 against the lightest gingham square (need 4.5). At 28 px (desktop) it is large and passes. Raise the cream or darken the lightest square slightly, or make it 24 px.
L3. `src/app/error.tsx`: lessons-learned section 3 says to move focus to the error message after any error. The new boundary uses `role="alert"` but does not move focus (same as the existing `chefs/[id]/error.tsx`, so not a regression).
L4. Touch size below 44 px (project convention; all above WCAG 2.5.8 24 px): chef availability day buttons 40 x 44 at 375 px; `/allergies` and booking form allergy checkbox rows 27 px tall (rows are about 43 px apart); inline text links 22 px (allowed); Leaflet zoom controls 30 px and cluster pin 36 px (library, existing).
L5. `rating-badge` and `price-tag` are separate spans with no whitespace or separator between them (the " · " is gone), so `textContent` reads "$28/hour4.8 out of 5 (14 reviews)". Screen readers usually split spans in a flex row, but adding a `sr-only` ", " would be safe.
L6. Cosmetic: dish form labels "Description (optional)" and "Dish photo" are smaller and lighter than "Dish name" and other labels; native "Choose File / No file chosen" is unstyled; on the dark /search "Price and date" panel the "Lowest/Highest" labels sit lower than "Day you need a chef" and the legend floats above empty space; the Next dev log still warns that Atkinson has no size-adjusted fallback (small text shift on font load, `display: swap`).

### Info
- `document-title` flake in `helpers.ts expectNoAxeViolations` exists on main (2/12 vs 3/12 on this branch). Suggest the helper wait for the title like `axeClean` in t052 does (separate small task; I did not edit helpers).
- PRODUCT.md line 29 is longer than the tagline shown (it continues "for far less than a private chef and less than eating out every day"). The UI uses only the first clause. Jimmy may want to confirm that clause as shipped copy.
- The real stack (Supabase) was not run here (no Docker); CI run 40014314370 was green for the earlier head.

## What the next agent needs
- Frontend: fix M1 (and optionally L1, L2, L5); then push and I can re-run: e2e-mock once plus the `/search` Tab-order check at 375 px, lint, typecheck, vitest.
- Reviewer: wait for M1 fix. L1 needs a policy decision.
