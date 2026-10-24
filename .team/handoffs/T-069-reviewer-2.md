Reviewer: APPROVE

Re-review of T-069 "Grandma's table" (WO-T069), changes since my REQUEST CHANGES at 1cf0fb1: Frontend fix round 2 (5bd64b9), Tester Recheck 2 (bfb46b8, d6a6852), and the main merge (9116f14). Handoffs read: `.team/handoffs/T-069-frontend.md` ("Fix round 2"), `.team/handoffs/T-069-tester.md` ("Recheck 2").

## Findings from round 1
- **R1 (Medium) hero focus ring: FIXED.** `src/app/globals.css:222-225` scopes `outline-color: var(--hero-ink)` to `.hero :focus-visible, .band :focus-visible`. Cream on the dark red passes 3:1 in both modes (Tester measured the real pixels: worst 5.02:1 light, 7.27:1 dark). Focus styling outside the hero and bands is unchanged.
- **R2 (Low) fake italic: FIXED.** `src/app/layout.tsx:21-22` loads the real italic (`style: ["normal", "italic"]`). Still self-hosted by next/font, so the CSP is unchanged. The Tester confirmed the real face loads. The 400 italic file is 19,576 bytes (measured on the dev server, not a production build).
- **R3 (Low) map origin dot: FIXED.** `src/components/search/map.css:41-46` uses `#f97316`, keeps the white border and adds a 2px `#2b211c` ring. Measured 3.16:1 against the red pins, and the dark ring stands out on every tile colour. The "orange dot" hint text is still true.
- **R4 gitignore: FIXED.** `.gitignore:62` `.shots/`.
- **D-184 placeholder sentence: removed cleanly.** `src/app/page.tsx` has no leftover wrapper or stray class. The tagline and button are unchanged. No other files referred to the sentence.

## New tests
- `e2e-mock/t069-focus-mock.spec.ts` (2 tests): compares the computed outline colour with the hero background. It runs fast and does not flake. The Tester showed the light-mode test fails on the old blue ring.
- `e2e-mock/t069-recheck2-focus-mock.spec.ts` (12 tests): samples screenshot pixels. Pixel sampling can be fragile, so I checked the risks. The viewport uses Desktop Chrome at DSF 1, so screenshot coordinates match CSS coordinates. Screenshots use `animations: "disabled"`. There is no `scroll-behavior: smooth`, so `scrollIntoView` finishes before the screenshot. The test also checks that the sampled ring pixel really is the outline colour (`ratio < 1.1`), so a misplaced sample fails loudly instead of passing quietly. The 3:1 threshold has a wide margin (5.0 or more measured). I ran both specs with `--repeat-each=2`: 28/28 passed. Flake risk is low.
- Info I1 (no action needed): `t069-recheck2-focus-mock.spec.ts` (sides array, about lines 108-137) computes a "gap pixel just inside" (s[4], s[5]), but the test never reads it. The comment promises more than the test checks. This is only dead code.
- Info I2: on `/search` and `/chefs/[id]`, nothing focusable sits inside `.hero`/`.band`, so those 8 cases only guard against future regressions (expected = 0). That is fine.

## Scope, merge, safety
- Diff 1cf0fb1..d6a6852 touches only `.gitignore`, the handoffs, the 2 new specs, `globals.css`, `layout.tsx`, `page.tsx` and `map.css`. Everything is in scope.
- Merge 9116f14: `git diff d6a6852 9116f14` contains only T-120's files (`next.config.ts`, the t105/t118 tests, the T-120 handoffs). There are no conflict markers. The t105 and t118 vitest suites pass on the merged tree (43/43).
- No screenshots, `.shots/` files or secrets in the PR (the only PNGs in the tree are `scripts/seed-images/*`, which came from main via T-121).
- MOCK labels and privacy: not affected by this round.

## Commands I ran (head 9116f14)
`npm run lint` clean; `npx tsc --noEmit` ok; prettier clean on all changed files; `npx playwright test -c playwright.mock.config.ts t069-focus t069-recheck2 --repeat-each=2` 28 passed; vitest t105 and t118 43 passed. CI on 9116f14 was still running when I wrote this. Merge only after the `ci` check is green.

## Builder choices Jimmy still has to confirm
1. Fonts: Libre Caslon Text (headings) and Atkinson Hyperlegible Next (body), both under the SIL OFL licence.
2. The header name "CookNeighbour" links to the home page.
3. Smaller hero picture on phones (instead of none).
4. "Price and date" is always open.
5. Lighter outline on the dark-mode primary button (`--btn-edge`).
6. Decorative animations stop after 3 cycles, with no pause button.
7. Soft text shadow on hero text.
8. Fallback font size of 98.5% (an estimate).
9. Tagline "Home-cooked food from your own culture, made by a neighbour." on `/` and `/search`.
10. New text on the 404 page and the error page.
11. Cuisine chip colours are picked from the cuisine name. Status pill colours: gold for waiting, green for accepted and completed, red for the rest.
12. Faint tablecloth pattern, red gingham hero bands, original SVG art with no people.
13. NEW: the map origin dot is bright orange `#f97316` with a white border and a dark `#2b211c` outer ring.
14. NEW: the real Libre Caslon italic is loaded for the tagline (about 19.6 KB more on `/`, dev-server measurement), instead of dropping the italic.
(The old item 13, the placeholder sentence, is closed: Jimmy decided it in D-184.)
