# Work Order WO-T126: 3D pot hero (open, stir, steam)

Task: T-126 (frontend). Branch `feature/T-126-3d-hero`, worktree `../CookNeighbour-wt-T126`. Jimmy 2026-10-23 called the T-069 logo and banner "a bit AI slop". On 2026-10-24 the Impeccable skill was invoked in full: a `critique` (18/32, snapshot `.impeccable/critique/2026-10-24T15-37-25Z__src-app-page-tsx.md`), then three new-world directions, then `overdrive`. Jimmy's answers: "I kinda like the current one, but I want more 3D and animations... surprise me", then "Real 3D pot (Recommended)", then "maybe open it fully and stir it, smoke goes up", then "Yes" to prototype v2. Earlier answers that still stand: the headline becomes the promise, with a small PROTOTYPE badge ("Yes, promise + badge (Recommended)"), and a small "I'm a home cook" link ("Yes, small text link"). The Grandma's table look (gingham, colours, fonts) stays. The earlier "retire gingham" answer was replaced by "I kinda like the current one".

The reference prototype is a single HTML file, `index.html` plus the `pot3d-stir.mp4` video, in the Planner's scratchpad. The Planner copies both into the worktree at `docs/design/t126-prototype/` before the builder starts. The prototype loads Three.js from a CDN only for preview; the app bundles it.

| Agent | Task | Plan | Effort | Risk |
|---|---|---|---|---|
| frontend | T-126 | **Invoke the Impeccable skill** (Skill tool): run `impeccable context`, then load `animate` and `craft-floor`. Paste the outputs in the handoff; "by hand" is not accepted. `npm install three` (bundled, so CSP `script-src 'self'` holds) with types. A client component `PotScene` is loaded with `next/dynamic` on `/` only, after the first paint and only when WebGL is available. Port the prototype scene: enamel pot, plate, gingham cloth, lid off then back on, spoon stirs the broth, steam plume, pot follows the pointer. Today's `HeroArt` SVG (minus sparkles and heart) stays as the first paint and the fallback (no WebGL, script error). Reduced motion shows a still frame. A visible Pause/Play button covers WCAG 2.2.2. The loop stops after 2 runs, pauses off-screen or in a hidden tab, and disposes WebGL on unmount. Fix the phone layout (lid clipped). H1 = approved promise; `.badge` PROTOTYPE (MOCK style); "I'm a home cook" links to chef sign-up. **Logo:** redraw `PotMark` small-first (one silhouette, legible at 16/24/36px, one colour). Unit tests for the pure timeline maths. E2E at 375 and 1280: fallback without WebGL, the Pause button stops motion, reduced motion, axe, no console or CSP errors. After building, run `impeccable detect` and an Impeccable `critique` on `/` and paste both in the handoff. | L | Bundle size on phones (target: three loaded lazily, at most about 160 KB gz, LCP unchanged); WebGL in CI headless (SwiftShader) |
| tester | T-126 checks | Re-run the e2e at 375/1280 in light, dark and reduced motion. Bite tests: break the fallback, and the no-WebGL test must fail; remove the Pause button, and the 2.2.2 test must fail. Measure the gzipped JS added to `/`. Check other pages are unchanged. Confirm the handoff carries real Impeccable output (not "by hand"). | M | Flaky WebGL timing; screenshot tests must freeze time (`?t=`-style hook in test mode only) |
| reviewer | T-126 review | Quality, a11y (2.2.2 pause, focus order, H1 meaning), performance (lazy load, disposal, off-screen pause), CSP intact, no CDN in app code, MOCK/PROTOTYPE labelling honest, headline wording matches Jimmy's approval, Impeccable outputs present. | S | Low |

## Recommendation
Approve all three. Words to approve: the H1 "A home cook from your culture, in your kitchen or theirs."; the badge "Prototype · nothing is real or charged"; the link "I'm a home cook →".

## Left out
- New visual world (Exercise Book, Fridge Shelf, Blue Hour GTA): set aside by Jimmy.
- Gingham on other pages: unchanged.
- A "how it works" line under the hero (critique P2): not asked for.
- DESIGN.md: not written in this task (extension of the existing look).
- Deploy: `main` auto-deploys on merge, as before.

## Decision
Ask Jimmy per agent: Approve, Reject or Approve with changes. Record each with `team-status decide` (`WO-T126-frontend`, `WO-T126-tester`, `WO-T126-reviewer`).
