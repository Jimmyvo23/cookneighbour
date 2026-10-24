Reviewer: REQUEST CHANGES

T-069 "Grandma's table" visual redesign, PR #233, head 1cf0fb1 (base main 9af7d4b). I read the frontend and tester handoffs (`.team/handoffs/T-069-frontend.md`, `.team/handoffs/T-069-tester.md`) and the full diff.

One Medium finding blocks: the focus ring cannot be seen on the red hero in light mode. It is a one-rule fix plus one test. Everything else is good.

## What I ran myself
- `npm run lint`: 0 problems. `npm run typecheck`: ok. `npm test`: 3241 passed, 3 expected fail (includes the Tester's new `src/app/error.tester.test.tsx`).
- e2e-mock was not run locally (port 3101 rule, lessons-learned section 4). CI on 1cf0fb1: `checks` pass; `e2e-mock` and `supabase` were still pending when I wrote this. Merge only on a green `ci`.
- No secrets, no `.env` files, no screenshots in the diff. `.shots/` exists in the worktree but is not tracked.

## Findings

### Medium (blocks)
**R1. The focus ring is almost invisible on the hero in light mode (WCAG 2.2 1.4.11 Non-text Contrast, AA; it also weakens 2.4.7).** `src/app/globals.css:216-218` uses one focus colour everywhere: `--focus: #1f4e8c` (line 47). The home page's main button "Find a home cook" (`src/app/page.tsx:21`, a `.btn-gold` inside `.hero` at line 8) sits on `--hero: #9e1f2a`, and the 2 px outline offset puts the ring on that red. Computed contrast of the ring against the background next to it: 1.06:1 on the plain red, 1.28:1 on a gingham square, 1.56:1 on a double square. The minimum is 3:1. Dark mode is fine (#8cb8f0 on #5e141c is 6.42:1 or better). The Tester checked that every ring exists and is at least 2 px, and took screenshots of form controls on the card, but not this button on the red cloth.
Fix: set a light ring inside the cloth, for example `.hero :focus-visible, .band :focus-visible { outline-color: var(--hero-ink); }`. Cream #fff8ee on #9e1f2a is 7.42:1, so it also holds on the gingham squares. Test: an e2e check that tabs to "Find a home cook" on `/` in light mode, reads the computed `outline-color` and the hero background, and expects 3:1 or more. Today no focusable element sits on `.band` (chef page), but adding the rule there keeps future links safe.

### Low (do not block; fix in this round if cheap)
- **R2. Fake italic.** `.hero-tagline` (`src/app/globals.css:494-497`) is italic Libre Caslon, but `src/app/layout.tsx:17-22` loads only `weight: ["400","700"]` in the normal style, so the browser draws a slanted copy of the regular font. Either add `style: ["normal","italic"]` (one more woff2 file) or drop the italic.
- **R3. The map's "orange dot" now looks like the pins.** `src/components/search/map.css:41`: the origin dot (#b45309) was easy to tell apart from the old green pins by colour. The new deep red pins (#8e1f26, line 14) are nearly the same colour, and the hint still says "The orange dot is your search area" (`SearchView.tsx`). Size and the missing number still tell them apart. A brighter orange would match the words again.
- **R4. `.shots/` is ignored only on this Mac** (`.git/info/exclude:24`), not in `.gitignore`. A fresh clone, or CI, could commit screenshots. Add `.shots/` to `.gitignore` in a notes PR.

### Info
- `src/app/page.tsx:19` still says "Placeholder home page. Features arrive in later tasks." It now sits in a full designed hero, the first thing the mentor sees. The task did not allow copy changes, so this is for Jimmy to decide (new copy needs his OK).
- Tests: the Tab-order test (`e2e-mock/t069-fix1-mock.spec.ts`) fails on the old M1 code at 1280 px (the button used to be the third stop), so it really covers the fix. At 375 px it allows a 40 px tolerance, which is fine. The allergy-row test measures the label, which is the real click area. Good.
- Scope: within the Work Order (phase 2 = all demo pages plus audit and polish). Small additions beyond restyling: the new `not-found.tsx` and `error.tsx` pages with new text, the header home link, the tagline. All are listed below for Jimmy. Less than 25% extra; no new areas.
- MOCK honesty: every MOCK badge, the MOCK payment notice, the kitchen "MOCK check" and "Nothing was inspected for real", and the admin MOCK lines are still there. `.mock-badge` keeps a 2 px border, the warning glyph and the word MOCK. Status pills keep their full words. Nothing suggests real checks.
- Privacy: no address or phone appears in any changed view. The booking list comment and behaviour are unchanged.
- Performance: fonts are self-hosted (6 woff2, CSP still `'self'`). The art is inline SVG with no ids. Decorative loops stop after 3 cycles and are off under reduced motion. No `background-attachment: fixed`. Photo sizes match their display size. Fine for a prototype.

## Decision on Tester L7 (Find chefs is the last Tab stop but sits in the top row at 1280 px): ACCEPT
DOM order is also the screen-reader reading order. Fill-in-then-submit is a meaningful order (WCAG 2.4.3) and matches every other form in the app. Moving the button earlier in the DOM would bring back M1 (submit before the filters). The jump happens once, upward, at the end of the form, and the ring is clearly visible on the card surface. The only way to remove the mismatch is to put the button under "Price and date" on desktop too, which undoes the round-2 hero row Jimmy approved. Jimmy can choose that, but it is not required.

## Builder choices Jimmy still has to confirm
1. Fonts: Libre Caslon Text (headings) and Atkinson Hyperlegible Next (body), both under the SIL OFL licence.
2. The header name "CookNeighbour" links to the home page (one more Tab stop; `chef-detail-tester.spec.ts` got one extra Tab press).
3. Smaller hero picture on phones (instead of none).
4. "Price and date" always open (not folded away).
5. Lighter outline on the dark-mode primary button (`--btn-edge`).
6. Decorative animations stop after 3 cycles, with no pause button.
7. Soft text shadow on hero text.
8. Fallback font size of 98.5%, an estimate.
9. Tagline "Home-cooked food from your own culture, made by a neighbour." on `/` and `/search` (the first clause of the PRODUCT.md positioning only).
10. New text on the 404 page ("This page could not be found", "The link may be wrong, or the page has moved.", "Find a home cook") and the error page ("Something went wrong", "Please try again.", "Try again").
11. Cuisine chip colours are picked from the cuisine name (the colour carries no meaning). Status pills: gold for waiting, green for accepted and completed, red for everything else (declined, cancelled, no-show, expired).
12. A faint tablecloth pattern on every page, red gingham hero bands, original SVG art with no people.
13. Whether to keep the "Placeholder home page" sentence for the demo (Info above).

## For the builder (one round)
Fix R1 and add its test. R2 to R4 are optional in the same round. After that the Tester rechecks the `/` focus ring (light and dark) and I re-read only the change.
