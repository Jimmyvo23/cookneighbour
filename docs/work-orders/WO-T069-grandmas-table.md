# Work Order WO-T069: Visual design pass ("Grandma's table")

Task: T-069 (frontend), Issue #232. Branch `feature/T-069-grandmas-table`, worktree `../CookNeighbour-wt-T069`. Found on the live site 2026-10-23: `src/app/globals.css` is still the create-next-app default (Arial, plain black or white), so every page looks unstyled; Jimmy: "there are no color and whatsoever", "all black". Jimmy 2026-10-23: "Yes, design pass now (Recommended)" (offered as: Frontend first shows a short design direction and one sample page for approval, then styles the demo pages; then Tester, then Reviewer), and look "Grandma's table" (offered as: soft paper background, deep red and gold accents, a classic serif heading font; traditional and homely, like a recipe book).

Phase 1 (this round, stop after it): design tokens and one sample page.
Phase 2 (only after Jimmy approves the sample): all demo pages, then Impeccable `audit` + `polish`.

| Agent | Task | Plan | Effort | Risk |
|---|---|---|---|---|
| frontend | T-069 phase 1 | Follow Impeccable (`.claude/skills/impeccable/SKILL.md`, craft-floor, typography, colour references). Replace the starter `globals.css` with a "Grandma's table" token set (paper background, deep red, gold, ink text; a designed warm dark mode, not black) in Tailwind v4 `@theme`; free OFL fonts via `next/font` (self-hosted, CSP stays `'self'`): a classic serif for headings, a readable sans for body text. Site header with the name, base styles for buttons, inputs, selects, checkboxes, radios, cards, links, focus rings and the MOCK badge. Restyle `/search` (form and results) as the sample. WCAG AA contrast in both modes; no change to text, roles, labels or test hooks. Screenshots of `/search` light, dark and 375 px for Jimmy. | M | Many e2e/a11y tests; contrast of gold; layout shifts |
| tester | T-069 checks | After phase 2: full suites, axe in both modes, 375 px, no copy or role changes. | M | |
| reviewer | T-069 review | After phase 2: Impeccable rules, honesty of MOCK labels, accessibility, no invented brand claims. | S | |
