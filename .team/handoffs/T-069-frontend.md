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
