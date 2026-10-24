# Handoff: T-126 3D pot hero (open, stir, steam) + logo redraw

From: frontend  To: tester

## What changed
- Branch: `feature/T-126-3d-hero` (Issue #237)
- Pull request: see the PR for this branch ("T-126: 3D pot hero (open, stir, steam) + logo redraw", Closes #237)
- Files:
  - `package.json`, `package-lock.json`: `three` ^0.186.1 and `@types/three` ^0.186.0 (bundled from npm, no CDN; CSP untouched).
  - `src/components/hero/pot-timeline.ts` (+ `.test.ts`, 17 tests): pure maths: lid pose, spoon phase, stir position, clock (2 cycles then rest, reduced = never active), steam rate, seeded random.
  - `src/components/hero/PotScene.tsx`: the three.js scene ported from the prototype (gingham cloth, plate, enamel pot, broth, lid, spoon, steam sprites, key and rim light, pointer spring). Colours come from the CSS tokens (`--hero`, `--gingham`, `--art-*`), so dark mode matches. Disposes geometries, materials, textures, PMREM target, shadow map and renderer on unmount.
  - `src/components/hero/HeroStage.tsx`: the hero shell. First paint = SVG `HeroArt`; after page load and idle, a WebGL check, then `next/dynamic(ssr:false)` loads the scene. Error boundary + `webglcontextlost` + no WebGL = SVG stays. Owns the Pause/Play button and `data-pot-state`.
  - `src/app/page.tsx`: new H1, `MockBadge` "Prototype · nothing is real or charged", "I'm a home cook →" link to `/signup`, "Find a home cook" kept. Document title unchanged.
  - `src/components/Ornaments.tsx`: HeroArt loses sparkles and the heart; `PotMark` redrawn (one silhouette, `currentColor`, no steam).
  - `src/app/globals.css`: hero stage, canvas layer, shade, cook link, `.pot-toggle`; removed `.sparkle` and `twinkle`.
  - `e2e-mock/t126-hero-mock.spec.ts` (19 tests, 375 and 1280), `e2e/home.spec.ts` (new H1).
- Behaviour: plays 2 cycles of 10 s then rests; pauses off-screen and in a hidden tab; reduced motion = one still frame (lid on, spoon at rest), no loop, no button; pointer follow only when motion is allowed.

## How to verify
- `npm run lint`, `npm run typecheck`, `npm test` (3270 passed, 3 expected fail, as before).
- `npx playwright test --config playwright.mock.config.ts e2e-mock/t126-hero-mock.spec.ts` (19 pass). Headless Chromium needs the SwiftShader flags; the spec sets them with `test.use({ launchOptions })`.
- `npx playwright test e2e/home.spec.ts` (2 pass).
- Full mock suite run once locally with 5 workers: 412 passed, 2 failed. Both were load flakes: `allergy-profile-tester-mock` "forgotten on log out" (30 s timeout, passes alone) and my own Pause test (a 700 ms wait too short under load; fixed with `expect.poll`; re-run of both files: 28 passed).
- Test-only hooks (dev and test builds only; `NODE_ENV !== "production"`): `?t=<seconds>` freezes the scene; `canvas[data-t]`; `canvas[data-plate-box|lid-box|spoon-box]` (screen px of each part, computed from projected vertices); the `pot:seek` event on the canvas jumps to a moment. Checked on `next start`: `?t=` is ignored, no `data-t`, state is `playing`, no CSP violation.
- `.hero[data-pot-state]` values: `svg`, `loading`, `ready` (not shown), `playing`, `paused`, `rest`, `still`, `frozen`, `fallback`.

### Bundle size (`next build`, Turbopack prints no per-route table, so measured from `.next`)
- Lazy chunk with three + the scene: 572,692 B raw, **141,163 B gzip -9** (target was about 160 KB). It is not in the script list of the prerendered `/` HTML nor of `/search`; the e2e checks `/search` loads no PotScene/three script.
- First-load JS added to `/`: `HeroStage` and the page code only (about 4 KB gz, chunk `103l4afwz`). The H1 is server-rendered HTML; three loads after `load` + idle (max 1.5 s wait), so LCP does not wait for it.

## Impeccable (real run, no helper agents: D-44)
`impeccable context --target src/app/page.tsx` key directives:
- PRODUCT.md read: web platform; users customer/chef/admin; voice "warm, plain and respectful, like a helpful neighbour; no hype"; principles: trust first (mocks labelled), plain words, safety visible, privacy; WCAG 2.2 AA, older users and English learners.
- `designPath: null`, `INCUMBENT_WORLD_UNDOCUMENTED`: code holds the visual world (Grandma's table); narrow refinements proceed from the code. I extended it, did not replace it.
- `MANUAL_DETECTOR_REQUIRED`: run `impeccable detect --json` on changed UI once at the end (done, below).
- `CONTEXT_STALE` (mention): `.impeccable/config.json` has an unread top-level key `telemetry`. Not touched.
- `reference/animate.md` and `reference/craft-floor.md` read and followed (kicker ban: the badge is a labelled status, not an eyebrow, and Jimmy approved it; no gradient text; shadows have offset and blur; focus ring from the hero token).

Motion thesis:
- Focal moment: one authored sequence, the lid lifts and leans behind the pot, the spoon arcs in and stirs while steam builds, everything is put back with a clink. Two runs, then rest.
- Continuity: the drawn SVG pot holds the layout box, the canvas fades in over it (400 ms, no movement), so nothing shifts; the pot leans toward the pointer with a slow spring.
- Feedback: the Pause/Play button (label and icon change); `data-pot-state`.
- Budget: WebGL runs only while visible, tab shown, not paused and before the 20 s end; pixel ratio capped (2 wide, 1.5 phone), 1024 shadow map, 110x110 cloth, 90 steam sprites max; three loads lazily after idle.

`impeccable detect --json src/app/page.tsx src/app/layout.tsx src/components`:
```
[]
```
(exit code 0). The helper steps (`impeccable-finish-reviewer`, `impeccable-documenter`) are skipped per D-44; the Planner runs the critique.

## Known gaps or risks
- The live "rests after 2 cycles, Play replays" flow has no e2e (20 s real time and SwiftShader speed make it flaky). The rest timing is covered by unit tests of `clock`; the replay token path is untested end to end. A Tester bite test of it is welcome.
- SwiftShader prints a console WARNING (not error) `texImage3D: FLIP_Y or PREMULTIPLY_ALPHA isn't allowed` from three's internals. The e2e only fails on errors and CSP violations.
- On `next start` without Supabase env the home page's `/api/me` call returns 500 (existing behaviour, unrelated).
- CI's Chromium may not give WebGL without the flags; the spec sets them. If WebGL is still missing in CI the play tests would time out (the no-WebGL tests would still pass).
- No screenshots are committed. Local ones (scratchpad): `.../scratchpad/m-1.9.png`, `m-4.5.png`, `d-1.9.png`, `d-4.5.png`, `dd-*.png` (phone, desktop, dark).
- Favicon: `src/app/favicon.ico` is a binary that does not use `PotMark`, so it is unchanged.

## Builder choices Jimmy has NOT confirmed
1. "I'm a home cook" links to plain `/signup`; there is no role query, so the form still starts on "customer". (Preselecting chef would need a change in `AuthForms`; not done.)
2. The badge reuses `MockBadge` (amber chip with a warning glyph), the existing MOCK style, with the approved words.
3. Button labels "Pause animation" / "Play animation"; after the animation rests the same button reads "Play animation" and replays. It sits bottom right of the hero and is hidden for reduced motion and until the 3D scene is ready.
4. Reduced-motion still frame = lid on, spoon resting, no steam.
5. The 3D scene appears about 1 to 3 s after load (idle callback, then the lazy chunk), fading in over the drawn pot.
6. Layout numbers: hero `min-height: 34rem`, picture cell `min-height: 20rem`, `padding-bottom: 5rem` (was `!pb-20`); the pot is sized from the picture cell (phone 1.15 and desktop 1.18 times the cell width over a 6.6-unit scene), shifted 20 px down on phones.
7. three 0.186 (prototype used 0.170): `PCFSoftShadowMap` no longer exists, so `PCFShadowMap` is used.
8. `PotMark` is one colour (`currentColor`, the header link colour) and the gold band is gone.
9. Hero H1 only changed; `<title>` and `pageTitle()` stay "CookNeighbour — prototype".

## What the next agent needs
- Tester: re-run the e2e at 375 and 1280 in light, dark and reduced motion; bite tests: break the fallback (no-WebGL test must fail), remove the Pause button (the 2.2.2 test must fail), put `process.env.NODE_ENV` hooks into production (they must not exist). Measure the gzipped JS added to `/` yourself. Check other pages are unchanged (the full mock suite passes locally).
- Port 3101 is the mock config port: only one worktree should run it locally.
