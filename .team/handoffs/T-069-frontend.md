# Handoff: T-069 Visual design pass "Grandma's table" (PHASE 1 of 2)

From: frontend  To: tester (after phase 2; phase 1 waits for Jimmy's approval of the sample page)

## What changed (phase 1)
- Branch: `feature/T-069-grandmas-table`. Pull request: not opened yet (by order).
- Files: `src/app/globals.css` (tokens, base, components), `src/app/layout.tsx` (fonts, site header with name and pot ornament), `src/app/page.tsx` (flex-1, token classes), `src/components/AccountBar.tsx`, `MockBadge.tsx`, `SkipLink.tsx`, `forms.tsx`, `chef/parts.tsx` (shared class constants now point at the token classes `.btn`, `.btn-secondary`, `.card`, `.hint`, so chef pages pick up the new buttons and cards), `search/SearchView.tsx`, `search/ResultCard.tsx`, `search/map.css` (pins red/ink, body font), `docs/work-orders/WO-T069-grandmas-table.md`.
- Fonts (next/font/google, self-hosted at build, CSP stays 'self'; both SIL OFL 1.1): headings Libre Caslon Text (400, 700), body Atkinson Hyperlegible Next (variable). Both avoid Impeccable's list of reflex faces.
- No visible text, role, label, id or test hook changed. The only added element is the header name "CookNeighbour" (a plain paragraph, not a link, so the Tab order is unchanged) and aria-hidden decoration (SVG pot, gold double rule).
- Search form is grouped: Where and The food prominent on one card; "Price and date" on a quieter sunken panel. Nothing collapses, so every field stays reachable and tests are untouched.

## Contrast (WCAG 2.2 AA, computed)
Light / dark:
- ink on paper 14.58 / 14.66; on surface 15.45 / 13.35; on sunken 13.16 / 15.52
- muted on paper 7.27 / 9.60; on sunken 6.56 / 10.16
- on-primary on primary (button) 8.39 / 6.23; on hover 10.51 / 4.98
- link on paper 8.21 / 8.82; on surface 8.70 / 8.02; on tint 7.29 / 7.14
- gold TEXT (goldtext) on paper 5.91 / 9.30; on gold-wash (tag) 5.34 / 7.09
- ink on gold fill 6.09 / 9.30
- success on paper 5.93 / 9.95; warning on warning-bg 6.34 / 8.18; danger on paper 7.00 / 8.82; danger on danger-bg 6.21 / 7.46
- MOCK text on MOCK bg 10.48 / 10.97; MOCK border on paper 5.50 / 9.30
- control edge on paper 4.07 / 4.70; on surface 4.31 / 4.28; on sunken 3.67 / 4.97
- focus ring on paper 7.72 / 8.66; on sunken 6.96 / 9.16
- Known gaps (honest): gold fill on paper is 2.39 in light, so gold is decoration only there (rules, avatar ring) and never carries meaning or text. Dark primary button fill against the page is 2.66; its label is 6.23 and it is identified by the label, but a lighter outline could be added if the Tester wants a 3:1 edge.

## How to verify
`npm run lint`, `npm run typecheck`, `npm test` (150 files, 3240 passed), `npm run test:e2e:mock` (376 passed, no test edited). `impeccable detect` on touched files: clean (exit 0). Screenshots in the session scratchpad `t069/` (search 1280 light, 1280 dark, 375 light).

## Known gaps or risks
- Next logs "Failed to find font override values for Atkinson Hyperlegible Next": no size-adjusted fallback font, so a small text shift may show before the font loads (display: swap).
- Other pages still carry older Tailwind colour classes (zinc, emerald, indigo, amber); phase 2 converts them. Dark-mode axe passes on all of them for now.
- Impeccable helper agents (finish-reviewer, documenter) skipped per D-44.
- Impeccable has no typography/colour reference files with those names; I used typeset.md, colorize.md and craft-floor.md.

## What the next agent needs
Phase 2 (after Jimmy approves): convert remaining pages to the tokens (`bg-surface`, `text-muted`, `.card`, `.btn`, `.control`, `.hint`, `.error-text`, `.tag`, `.mock-badge`), then Impeccable audit and polish. Open choice: should the header name link home (adds one Tab stop and needs an edit to `chef-detail-tester.spec.ts`).

---

# Round 2 (Jimmy: "more eye catch and fun")

## What changed
- `/search` now has a hero: a red gingham tablecloth band (pure CSS) with a scalloped lace edge, the big serif headline, the approved positioning line from PRODUCT.md as supporting text (the only new copy), and an original SVG hero picture (pot with a gold heart on a plate, wooden spoon, basil, sparkles; no people). The form is a stitched-border "recipe card" laid over the cloth: Where, The food and a big Find chefs button share one row; the other filters sit below in a quieter area (radio tiles, language, allergens, price panel). On a phone the Find chefs button comes after all filters (CSS order).
- `src/components/Ornaments.tsx` (new, drawn by me): PotMark (header logo, steam loops), HeroArt, SprigMark, EmptyPlate, Star. Aria-hidden. Colours from `--art-*` tokens, with a separate dark palette.
- Chef cards are recipe cards: taped polaroid photo, serif name, cuisine chips in five warm tints (tomato, saffron, herb, berry, terracotta; picked by cuisine name), saffron price tag, herb-green rating badge. Hover lifts the card and straightens the photo. Skeleton loading cards with a steaming pot, a friendly empty state (plate and cutlery) and an idle state with the plate.
- New tokens: saffron, herb, hero red, gingham, five chip pairs, art palette, a gold glow in dark mode. Motion: steam, hero float, sparkle, cards rise (movement only, no fade), all off under `prefers-reduced-motion`.
- Touched: `globals.css`, `layout.tsx` (PotMark), `forms.tsx` (SubmitButton takes a className), `SearchView.tsx`, `ResultCard.tsx`, `map.css` (framed map), `Ornaments.tsx`.
- Fonts unchanged (Libre Caslon Text, Atkinson Hyperlegible Next, both OFL).

## Tests
- No test edited. lint 0 errors, typecheck ok, vitest 3240 passed, e2e-mock 376 passed, `impeccable detect` exit 0.
- Found by axe on the way: a fade-in on cards read as low contrast mid-animation, so the card entrance uses movement only.
- Cuisines are now chips; each has a visually hidden ", " before it so the text still reads "Cuisines: Vietnamese, Thai". The "$28/hour · 4.8 out of 5" dot separator is gone (price tag and badge are separate elements; same strings).

## Contrast (computed, light / dark)
chips 6.5 to 8.3 / 8.1 to 9.3; saffron price tag ink 8.61 / 10.59; rating badge herb on wash 6.67 / 8.88; hero cream text on the lightest gingham square 4.6+ / 8.3; tagline is large text. Star icon and gold art are decoration (the rating is also written out).

## Known gaps
- The hero picture is hidden below 640 px to keep the phone page short; the phone view still has the gingham and headline.
- Gingham text contrast is computed on the overlap square; axe passes but cannot measure gradients, so the Tester should eyeball the hero at 375 px.
- Other pages keep the round 1 look until Jimmy approves this sample.

---

# Phase 2 (Jimmy: "Yes, do all pages")

## What changed
- Every page now uses the tokens. All old zinc, emerald, indigo, amber and red Tailwind colours are gone from `src` (grep is empty). Notices use `.notice` (gold), `.notice-ok` (herb) and `.alert-box`; inputs use `.control`; buttons `.btn`, `.btn-secondary`, `.btn-gold`.
- The whole site sits on a faint red-and-white tablecloth. Page titles (h1) are a gingham ribbon with a gold double edge (`main h1`, except `.hero-title`).
- Home `/`: full-height gingham hero with the pot picture, the positioning line and a gold button.
- Chef detail: gingham band with a taped polaroid, price tag and rating badge; dishes are recipe cards with a polaroid photo, an "eat by" stamp and allergen chips; available days are little calendar tiles; cuisine chips.
- Booking flow: estimate is a paper receipt with torn edge, dotted leaders and a serif total; MOCK payment stays a loud gold notice; dish allergens are chips, "Eat by" is a stamp; chosen options are washed red.
- Bookings: status pills (waiting = gold, accepted/completed = herb, other = red), empty states with the plate.
- Auth pages (`Page` in forms.tsx): the form is a stitched recipe card with a steaming pot peeking over its edge.
- New: `src/app/not-found.tsx`, `src/app/error.tsx`, `LoadingFallback` (steaming pot, text stays exactly "Loading..."), `chips.tsx` (cuisine chips, status pills).
- Chef and admin pages get the same tokens, ribbons and cards; admin stays calm (no illustration).
- Open choices (builder defaults, to be confirmed by Jimmy): smaller hero picture on phones: yes; header name is now a link home; "Price and date" stays open; dark primary button has a lighter outline (`--btn-edge`).
- Phone: the `/search` hero shows a small picture instead of none.

## Test edits (one)
- `e2e-mock/chef-detail-tester.spec.ts` "keyboard: the Back link is the first Tab stop": one more `Tab` press (5 instead of 4) because the header name is now a link and is a new stop before the Back link. Pure order change; the focus assertion is unchanged. No axe or accessibility assertion was touched or weakened.

## Contrast (computed; light / dark)
ink on notice gold 13.31 / 11.42; ink on notice herb 13.42 / 11.25; status gold 5.34 / 7.09; status herb 6.67 / 8.88; status red (ink on danger-bg) 12.92 / 12.39; saffron button ink 8.61 / 10.59; dark button outline vs paper 7.59 (light 8.21); star on rating badge 4.33 (decoration, rating is written out) and 5.15 on surface; link on the tablecloth-tinted page 7.59, muted text 6.72 / 9.17; stamp link on surface 8.70 / 8.02. Gingham patterns were checked by hand on the lightest overlap square (see round 2).

## Results
lint 0 errors, typecheck ok, vitest 3240 passed, e2e-mock 376 passed, `impeccable detect` exit 0 (one finding on `.day`'s thick top border was fixed). Impeccable audit and polish were done by hand against `audit.md` and `polish.md`: no horizontal scroll at 375 px on any page (checked by image width), tap targets 44 px, reduced motion keeps a static alternative, every colour from tokens. Helper agents skipped per D-44.
