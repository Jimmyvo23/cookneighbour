# Handoff: T-126 v2 clay-pot hero, happy-pot logo, calm site

From: frontend  To: tester

## What changed
- Branch: `feature/T-126-v2-clay-hero` (Issue #237). Pull request: see PR "T-126 v2: clay-pot hero, happy-pot logo, calm site".
- Commits (one per plan task, plus one own-check fix):
  1. `dad07cc` Task 1: clay tokens (light and dark), gingham, cloth, lace, h1 ribbon and double rules removed; `src/app/theme-contrast.test.ts`.
  2. `9f1c9af` Task 2: `PotMark` redrawn as the happy pot, `src/app/icon.svg`, `favicon.ico` deleted, `PotMark.test.tsx`, logo hover CSS.
  3. `d7d1ae1` Task 3: `src/lib/home/demo-pots.ts` + test pinned to `scripts/seed-data.ts`.
  4. `54525d9` Task 4: `src/components/home/PotMap.tsx` + 14 unit tests, map CSS.
  5. `16d6fb7` Task 5: `FamilyTable.tsx`, new `src/app/page.tsx`, home CSS, `e2e-mock/t126-home-mock.spec.ts`, `e2e/t126-home-real.spec.ts`, `e2e/home.spec.ts` heading.
  6. `65aa386` own-check fixes (see Builder choices).
- Other files: `globals.css`, `Ornaments.tsx`, `SearchView.tsx` (one class: `hero !pb-28`), `e2e-mock/t069-focus-mock.spec.ts` and `t069-recheck2-focus-mock.spec.ts` (comments, ring-name and sampler fix below).
- No new npm packages. `npm ci` was run in the worktree (it had no node_modules).

## How to verify
- `npm run lint`: clean. `npm run typecheck`: clean. `npm test`: 155 files, 3278 passed, 3 expected fail (same as before; new files add PotMap 14, demo-pots 4, PotMark 2, theme-contrast 5).
- `npm run test:e2e:mock`: 409 passed (full run before the last small commit), then `e2e-mock/t126-home-mock.spec.ts` 15 passed and the two t069 focus specs 12 passed after it. `e2e/*-real.spec.ts` NOT run locally (needs the real stack; CI only).
- Screenshots (git-ignored) in `/Users/kienvo/Desktop/Claude projects/CookNeighbour-wt-T126v2/.shots/`: `home-{light,dark}-{375,1280}-{closed,open}.png`, `search-light-1280.png`, `chef-light-1280.png`, `signup-errors-light-1280.png`, `logo-hover-1280.png`.

## Impeccable (really run, CLI `.claude/skills/impeccable/scripts/impeccable`)
- `impeccable context` exit 0, printed PRODUCT.md (Platform web, principles) and the notices "INCUMBENT_WORLD_UNDOCUMENTED: PRODUCT.md exists and DESIGN.md is missing" and IMAGE_TOOLS (sips, ffmpeg). I read `reference/craft-floor.md` before UI edits.
- `impeccable detect src/app/page.tsx src/components/home src/components/Ornaments.tsx src/app/globals.css` exit 0:
  `0 anti-patterns found.` and 6 advisory notes (not failures), all `[bounce-easing] cubic-bezier(0.2, 1.6, 0.4, 1)` / `(0.2, 1.5, 0.4, 1)` / `(0.2, 1.2, 0.4, 1)` at globals.css lines 876, 953, 965, 1094, 1098, 1102. Kept on purpose: the spec says the lid has "a little bounce" (Jimmy approved the demo). Planner may overrule in the critique.
- Impeccable helper agents are removed (D-44): the finish-reviewer and documenter steps were skipped; `critique` is the Planner's step.

## Builder choices (not in the plan's pinned token table)
- `PotMap` is plain `fetch` (not `apiFetch`) and skips the lookup in MOCK mode (`isMockEnabled()`), so mock mode always shows `/search`.
- Link text uses a/an: "Find a Vietnamese cook", "Find an Indian cook", "Find a Jamaican cook" (plan pattern `Find a {cuisine} cook` would say "a Indian").
- Tests use `react-dom/client` + `act` (the repo has no Testing Library); no package added.
- PROTOTYPE badge: no such component existed, so it is `<span class="mock-badge">PROTOTYPE</span>` (same loud yellow as MOCK).
- New tokens: `--map-land` (= `--hero`), `--map-lake` #bcd3f5 / dark #243b5a, `--map-lake-ink` #2f4a7f / #c9dcf7, `--map-road` #fffaf3 / #3a2c22, `--map-park` #dfe8d8 / #33402f, `--map-shadow` #e9d3bb / #1e1611, `--map-steel` #7a8793 / #8b97a3, `--map-steel-dark` #5c6772 / #5f6b77, `--map-steam` = `--gold`, `--art-clay` #c66a3d / #e9a07a, `--table-floor` #f3e4d3 / #241a14, `--table-top` #e9c9a3 / #3a2a1f. Contrast test covers map-lake-ink on map-lake and muted on hero.
- Dark lake colour: #243b5a. Bubble art: simplified from the demo (soup, curry, fish) in tokens; no flames.
- Map city labels moved under their pots (centred) and enlarged to 20 map units so they stay readable at 375 px; the demo had them beside the pots and they collided.
- Removed more ornament for "calm": header `3px double gold` border now 1px line; `.band` double border now 1px line; `.recipe-card::before` stitched dashed border deleted. Still present (not touched, for the critique): `.title-rule`, dotted gold underline under card h2, polaroid tape, dashed `.stamp`, `.section-rule`, receipt torn edge, `.price-tag`.
- Home markup: `div.hero > section.home-hero > div.home-copy, div.home-map, div.home-table` (the `.hero` wrapper keeps the T-069 ring tests working). DOM order copy, map, table; a test checks computed `order` is 0 for all three.
- `.hero` bottom padding is 3rem; the search page keeps its old overlap via `!pb-28` (without it the hero text was covered by the form card; a test now guards this).
- Card `min-height: 8.75rem` so the page height does not change between pots (a test checks 320, 375, 1280).
- `t069-recheck2` spec changes (assertions not relaxed): focus targets are named by `aria-label` (the pot buttons have no text, so all were "BUTTON" and the loop stopped after the first); the pixel sampler uses `Math.floor` not `Math.round` (pixel N covers N to N+1; fractional pot box exposed that the old rounding sampled the ring's edge pixel).

## Known gaps or risks
- Real e2e `e2e/t126-home-real.spec.ts` and `e2e/home.spec.ts` are unrun locally; CI runs them. The real spec needs seeded Chef Lan (approved, with bio, photo, dish; T-121 placeholder photos) to appear in `GET /api/chefs?city=Mississauga&cuisine=Vietnamese`; if A-20 hides her, the link shows the fallback and the real test fails.
- Pots are drawn with the 44 px hit box larger than the visible pot at 320 to 375 px (box includes the bubble space).
- Dark-mode and the `--glow` halo on `.btn-lg` (existing) may be flagged by the critique.
- The Next dev server logs a font-override warning (offline font); unrelated.

## What the next agent needs
- Bite tests to try: change a seed dish name (demo-pots test fails); make the link always `/search` (the "links to the chef when found" test fails); add CSS `order` to `.home-copy` (computed-order test fails and keyboard test).
- Check readability of search, chef, booking and admin pages without gingham (screenshots for search and chef are in `.shots/`).

## Fix round 1 (approval WO-T126v2-fix1, Impeccable critique 22/32, snapshot `.impeccable/critique/2026-10-26T15-01-13Z__src-app-page-tsx.md` committed)
1. P1 headline: `.hero .home-title { clamp(2.25rem, 5vw, 3.25rem); line-height 1.12 }`; mock e2e "headline fits on at most two lines at 1280" (height <= 2 line-heights). Now 2 lines, no collision.
2. P1 dark pots: tokens `--pot-lid-red`, `--pot-herb-lid`, `--pot-herb`, `--pot-bubble-bg`, `--pot-bubble-fill` (dark: #b8603f, #6fa08c, #a9d3c2, #f5e9dc, #e9a07a), dark `--map-shadow` #3a2c22. `theme-contrast.test.ts` checks pot body, lids and bubble fill at 3:1 against the land in both modes, and the dark bubble ring. Builder choice: the dark bubble ring is cream (#f5e9dc), not the suggested #4a382e, because #4a382e is only 1.5:1 against the land.
3. P1 fallback link: `/search?city=<City>&cuisine=<Cuisine>`. `searchPrefill()` in `src/lib/search/search.ts` (6 unit tests) and a one-shot effect in `SearchView` (waits for the city list and clock, wins over the saved form, ignores unknown city, repeated or bad cuisine, no error). Tests: PotMap href unit tests, mock e2e "pot link opens search with city and cuisine filled and results loaded", and "ignores a bad city or cuisine".
4. P2 reward: pots are 18 to 19 percent of the map width, dish bubble 1.6x, dish picture in the card beside the text, card min-height tuned per width (10rem under 23rem, 8.5rem, 7.25rem from 40rem) with a test that the height does not change between pots at 320, 375, 768, 1024, 1280. Idle cue: each closed pot lifts its lid once on load (0.6 s, 1 s, 1.4 s delays, one cycle, none under reduced motion). Hover/focus already opens a pot. Builder choices: each pot's drawing box has headroom for the lifted lid and the bubble sits 20 to 26 units above it, and the steam is two wisps either side of the middle, so the focus ring never crosses a lid, bubble or caramel stroke (the T-069 ring test caught all three; no threshold changed). Mississauga moved down (base 224, width 18 percent) so its bubble is not clipped by the map edge.
5. P2 fewer labels: `home-brand` removed; card shows "Chef Lan" + DEMO badge (aria-label of the pot keeps "(demo)"); PROTOTYPE badge is smaller and sits just above the headline.
6. Table: frame rect and `--table-floor` removed, max width 17rem, under the copy on desktop (grid areas "copy map" / "table map"; DOM order unchanged, test checks `order` is 0), spoon and fork `--art-clay`, Brampton pot is warm clay, `.ft-centre` easing is ease-out (0.22, 1, 0.36, 1).
7. T-127 `tests/rls/contact-privacy-tester.test.ts`: the four D-52 cases are now built from the NEXT fall-back and spring-forward change in Toronto (a change qualifies when change minus 8 days is tomorrow or later, as the database refuses past visit days). The expected UTC instant is worked out from the Toronto wall clock with Intl (tries -4 and -5 hours), independent of the database, so the assertions are unchanged. With today 2026-10-26 it uses 2027-11-07 and 2027-03-14. I checked the helper logic locally with node; the RLS tests themselves run only in CI. Other tests in the file still use fixed 2027-04 and 2027-06 days and will rot later; recorded in `docs/lessons-learned.md`.
8. Hint copy "Tap or click a pot on the map: who is cooking near you?"; dark `--glow` reduced to `0 0 12px rgb(227 130 92 / 14%)`.
- Results: lint, typecheck clean; `npm test` 156 files, 3285 passed, 3 expected fail; `test:e2e:mock` 415 passed and 1 failed in the full run (`t072-waiting-check-mock` dark axe `color-contrast` on the chat Send `.btn`, a transient state; it passed on its own re-run, and I did not touch `.btn`); see the final report for the last run.
- Screenshots retaken in `.shots/` (home light and dark, 375 and 1280, closed, Mississauga open, Brampton open; search, search prefilled, chef, signup errors, logo hover). Note: on a cold dev server the first page loads can show a stale stylesheet (black fills, huge card svg); the screenshots were taken after a warm-up.

## Fix round 2 (Tester F-1, F-4)
- F-1 (`src/app/globals.css`): `color 160ms cubic-bezier(0.22, 1, 0.36, 1)` added to both `.btn` / `.btn-secondary` transition lists, so text and background fade together on a theme switch (axe no longer reads a half-way contrast). Under `prefers-reduced-motion: reduce` `.btn, .btn-secondary` have `transition: none` (this was not set before). The Tester's animation wait in `t072-waiting-check-mock.spec.ts` is kept. `t072-waiting-check-mock.spec.ts --repeat-each=5`: 20 passed (4 tests x 5), 0 failed.
- F-4 (`src/app/theme-contrast.test.ts`): `pot-herb` vs land at 3:1 in both modes (new row in the pots test; `pot-bubble-bg` dark and `pot-bubble-fill` both modes were already covered at 3:1). New pin test for the dark values `map-shadow #3a2c22`, `pot-bubble-bg #f5e9dc`, `pot-bubble-fill #e9a07a`, `pot-herb #a9d3c2`; reason in the test: the shadow is deliberately subtle, so it is pinned, not held to 3:1. Bite test, each dark value reverted once: map-shadow (pin fails), pot-herb (3:1 test and pin fail), pot-bubble-bg (3:1 test and pin fail), pot-bubble-fill (3:1 test and pin fail); all restored.
- Results: lint and typecheck clean; `npm test` 156 files, 3286 passed, 3 expected fail; `t126-home-mock` + `t126-tester-mock` 57 passed.
