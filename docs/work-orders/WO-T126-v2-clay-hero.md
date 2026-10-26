# Work Order WO-T126v2: clay-pot hero, happy-pot logo, calm site (Version 2)

Task: T-126 v2 (frontend). Issue #237 (retitled). New branch `feature/T-126-v2-clay-hero`, worktree `../CookNeighbour-wt-T126v2`. The old 3D direction (PR #238) was closed on 2026-10-26 (Jimmy: "Close, keep branch").

Spec: `docs/superpowers/specs/2026-10-26-hero-logo-design.md`. Plan (6 tasks, test-first): `docs/superpowers/plans/2026-10-26-t126-v2-hero-logo.md`. Approved look: the demo `docs/design/t126-v2/demo-v2-home.html` with screenshots `demob-*.png` (Jimmy: "like it").

| Agent | Task | Plan (100 words or fewer) | Effort | Risk |
|---|---|---|---|---|
| frontend | T-126 v2 build | **Invoke Impeccable** (context + detect) and paste its output; "by hand" is rejected. Plan tasks 1-5, test-first: (1) clay-pot tokens light + dark, remove gingham, cloth, lace and the h1 ribbon site-wide, plus a contrast unit test; (2) redraw `PotMark` as the happy pot + `icon.svg`; (3) `DEMO_POTS` pinned to the seed by a test; (4) `PotMap` client component: 3 pot buttons, live card, chef link via `GET /api/chefs` with a `/search` fallback; (5) `FamilyTable` + new `page.tsx`, phone order words → map → table, e2e and axe. Screenshots for Jimmy. No new packages. | L | Recolouring touches every page; colour-based assertions break |
| tester | T-126 v2 checks | Re-run the full mock and real e2e. Check light, dark, reduced motion, and 320/375/1280. Bite tests: break the seed pin and the test must fail; break the chef-link fallback and it must fail; add `order` to the layout and the Tab-order test must fail. Check that search, chef, booking and admin pages are readable without gingham. Confirm the handoff carries real Impeccable output. | M | Flaky hover timing in e2e |
| reviewer | T-126 v2 review | Quality, accessibility (button names, aria-live card, focus, 44 px targets, contrast both modes), honest DEMO/PROTOTYPE/MOCK labels, no new packages or CDN, CSP intact, copy matches the spec, danger red vs terracotta stays clear, Impeccable output present. | S | Low |

## Recommendation
Approve all three. After the build, the Planner invokes the Impeccable `critique` and shows you the screenshots, including **dark mode** (spec open question 5), before the Tester starts.

Words to confirm (Planner wording, not yet approved by you): card link "See Chef Lan", and the fallback "Find a Vietnamese cook".

## Left out
- The search page keeps its own hero drawing (old `HeroArt`); only its colours and gingham change. A redraw would be a later task.
- Pre-selecting "chef" on sign-up from "I love to cook".
- Real map data, photos, a DESIGN.md.
- Tag v2.0.0: only after you approve the release.

## Decision
Ask Jimmy per agent: Approve, Reject or Approve with changes. Record each with `team-status decide` (`WO-T126v2-frontend`, `WO-T126v2-tester`, `WO-T126v2-reviewer`).
