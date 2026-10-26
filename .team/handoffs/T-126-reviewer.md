APPROVE

Reviewer verdict for T-126 v2 (PR #239, branch `feature/T-126-v2-clay-hero`, head `80062dd`). I reviewed the whole diff against `origin/main`, the Work Order, spec, plan (including Review Focus), the Impeccable critique snapshot, `.team/handoffs/T-126-frontend.md` (fix rounds 1 and 2) and `.team/handoffs/T-126-tester.md`.

## Verification (run by me at 80062dd)
- `npm run lint`: clean. `npm run typecheck`: clean. `npm test`: 156 files, 3286 passed, 3 expected fail.
- `gh pr checks 239`: checks, ci, e2e-mock, supabase all pass (run 40359137225).
- I did not re-run the mock or real e2e suites locally. I rely on CI and on the Tester's runs (452 mock passed, plus the bite tests).

## What I checked and found OK
- **Quality:** the code is readable and follows repo idioms. `HeroArt` and `Steam` in `Ornaments.tsx` are still used by `SearchView` (the WO left them out on purpose), so they are not dead code. `PotMark` is redrawn and used everywhere. There is no CSS `order` in `globals.css` or the home markup. The desktop layout uses `grid-template-areas`, and the DOM order is copy, map, table.
- **Security and privacy:**
  - `package.json` and `package-lock.json` are unchanged, so there are no new packages.
  - `security-headers.ts` is untouched and the CSP is intact. There is no CDN and no external `url()`. Inline `style` attributes are allowed by the existing `style-src 'unsafe-inline'`.
  - `GET /api/chefs` is unchanged and still filters `status = 'approved'` (`src/lib/server/search.ts:107,182`). `PotMap` only reads `id` and `displayName`, and it type-checks `id` before use.
  - `searchPrefill` takes a city only from the known list (ignoring case). It takes a cuisine only if it appears once, is 40 characters or fewer and has no control characters, and the value then goes through the existing form validation. The Tester also checked `%00`, `__proto__`, repeated and empty params.
- **Accessibility:**
  - Pots are real `<button type="button">` elements, named for example "Pho bo by Chef Lan (demo)", with `aria-pressed`.
  - The card has `aria-live="polite"`. The map svg is `role="img"` with a label, and the decorative svgs are `aria-hidden`.
  - The focus ring is 3 px `--focus` (the contrast test covers paper and hero in both modes, and the pixel spec covers the pots). Targets are at least 2.75rem.
  - Reduced motion turns off the lid, steam, bubble, load nudge, table and `.btn` transitions.
  - The token contrast pairs are tested in both modes. Errors keep their text and outline (the Tester checked `/signup` in both modes).
- **Spec and copy:**
  - H1 "Miss your mom's cooking?", the price line, "Find a home cook" to `/search` and "I love to cook" to `/signup` all match exactly.
  - The hint is "Tap or click a pot on the map: who is cooking near you?" (critique fix round 1). The empty card is "Neighbours are cooking." / "Pick a pot to see the dish, the cook and how long it takes."
  - Card links say "See Chef Lan" or "Find a {cuisine} cook" (with a/an).
  - The phone order is words, map, table.
  - Gingham, cloth, lace, `repeating-linear-gradient` and the h1 ribbon are gone from `src/` (the contrast test guards this).
  - Light tokens match plan Task 1. Every other token is listed as a builder choice in the frontend handoff.
- **Mocks:**
  - The PROTOTYPE badge is shown, every open card shows a DEMO badge, and the pot names say "(demo)".
  - In MOCK mode the server is not called, and the comment says so.
  - The map is labelled "Drawn map ..., not to scale".
  - Nothing claims real data.
- **T-127:** the four D-52 cases keep the same boundaries (last day = change - 8 and change - 2 for fall-back; change - 8 and change - 4 for spring-forward). The expected UTC is still computed independently of the database (Intl wall clock), and the `it.each` comparison is unchanged. No assertion was weakened.
- **Tests:** they check behaviour (roles, names, hrefs, card text, computed order, layout boxes, contrast maths). The bite claims are plausible: I followed the Tester's table against the test names, and the fix round 2 claims fit the new pin test.
- **Impeccable:** the frontend handoff has real `context` and `detect` output (exit codes, notices, 6 bounce-easing advisories with line numbers). The critique snapshot `.impeccable/critique/2026-10-26T15-01-13Z__src-app-page-tsx.md` is committed (22/32, 3 P1, all fixed in round 1). This was not done "by hand".

## Findings (none block)
- **LOW** `tests/rls/contact-privacy-tester.test.ts:83-100`: the dates are now computed, but nothing asserts that they really cross daylight saving. If `nthSunday` or `nextChange` ever picked a wrong Sunday, the cases would still pass on ordinary days, and the D-52 daylight-saving meaning would be lost without anyone noticing. Suggest one guard assertion in a follow-up: the first fall case expects `T04:00`, the second `T05:00`, the first spring case `T05:00`, the second `T04:00`. Today's logic is correct (the Tester checked 7 dates in node).
- **LOW** `src/app/globals.css:121` (dark `--danger #ff9c93`) against dark `--primary #e3825c`: in dark mode the two are closer in hue than in light. Error messages always carry text and an outline, so this is not a failure today. Keep the rule that an error never uses a solid fill like a button.
- **LOW** `src/components/home/PotMap.tsx:106`: `onMouseEnter` updates the `aria-live` card, so moving the mouse across the map can make a screen reader announce several pots. This is low impact, and the critique noted it under heuristic 3. Optional later polish: a short hover delay, or open on hover without announcing.
- **NIT** `src/lib/search/search.ts:407`: `cuisine.length <= 40` repeats the number; use `TEXT_MAX` from `@/lib/domain/search` (it is 40) so the two limits cannot drift apart.
- **NIT** `src/app/globals.css:892`: `a:hover .pot-lid` is not scoped to `.pot-mark`. It works because only `PotMark` uses `.pot-lid`, but `a:hover .pot-mark .pot-lid` would be safer.
- **INFO** `src/app/globals.css:1178-1180`: on desktop the table now sits under the words ("copy map" / "table map"). Spec section 5 and plan Task 5 put it above the words. This came from the critique in fix round 1 and needs Jimmy's confirmation (listed below).
- **INFO** Tester F-1 was fixed in the app (`color` added to the `.btn` transitions, and `transition: none` under reduced motion), which is good. Tester F-2 (a 59 px header shift at 375 px on every page, also on `main`) deserves its own ticket.
- **INFO** Scope: about 2,860 lines added, but most of it is docs, demo assets and tests. The `searchPrefill` and `SearchView` change is a small new area. It came from the critique P1 and the spec's "search for that city and cuisine", so it is in scope.

## Builder and critique choices Jimmy has not yet confirmed
1. Card link words "See Chef Lan" and fallback "Find a {cuisine} cook" with a/an ("Find an Indian cook"). The WO says this is Planner wording, not yet approved.
2. The fallback link carries `?city=&cuisine=` and pre-fills and runs the search. The pre-fill wins over the saved form.
3. Map hint changed to "Tap or click a pot on the map: ..." (the spec said "Tap a pot ...").
4. The card shows "Chef Lan" without "(demo)". The DEMO badge and the pot name keep the demo label (the spec card text had "Chef Lan (demo)").
5. The `home-brand` line (logo + name above the headline) is removed. The PROTOTYPE badge is smaller and sits above the headline.
6. Desktop layout: the table is under the words, not above them. The table frame and floor are removed, its maximum width is 17rem, the spoon and fork are clay and the Brampton pot is clay.
7. Idle cue: each closed pot lifts its lid once on load (staggered, one cycle, none under reduced motion).
8. Pot size is 18 to 19 percent of the map width, the bubble is 1.6x, the dish picture sits in the card, and the card minimum height varies by width. Mississauga is moved down. City labels sit under the pots at 20 units.
9. New tokens not in the plan table: `--map-*` (lake #bcd3f5 / dark #243b5a, lake ink, road, park, shadow light #e9d3bb / dark #3a2c22, steel), `--art-clay`, `--table-top`, `--pot-lid-red`, `--pot-herb-lid`, `--pot-herb`, `--pot-bubble-bg` (dark cream #f5e9dc instead of the suggested #4a382e), `--pot-bubble-fill`, and `--table-floor` (since removed).
10. Bubble art simplified (soup, curry, fish; no flames). Steam is two side wisps.
11. Extra calm removals beyond the spec: the header double gold border is now a 1px line, the `.band` double border is now a 1px line, and the `.recipe-card` stitched border is deleted. Still present: `.title-rule`, the card h2 dotted underline, polaroid tape, `.stamp`, `.section-rule`, the receipt torn edge and `.price-tag`.
12. The dark `--glow` is reduced to `0 0 12px rgb(227 130 92 / 14%)`.
13. The bounce easing on the lids and table is kept (6 Impeccable advisories). Only `.ft-centre` was softened.
14. The PROTOTYPE badge reuses the `.mock-badge` style (yellow like MOCK).
15. In MOCK mode `PotMap` skips the lookup and uses plain `fetch` (not `apiFetch`).
16. The search page `.hero` keeps a 7rem bottom padding (`!pb-28`) while the home hero uses 3rem.
17. `favicon.ico` is deleted and replaced by `src/app/icon.svg`.
18. Dark mode as a whole: Jimmy approved the look (Planner report). Please record it as a decision row if that is not already done.

Reviewer, T-126.
