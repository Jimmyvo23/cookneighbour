# Handoff: T-126 v2 clay-pot hero, happy-pot logo, calm site (Tester)

From: tester  To: reviewer

## Verdict: PASS (no HIGH finding open; one MEDIUM test regression fixed in test files, details below)

## What changed
- Branch: `feature/T-126-v2-clay-hero`, PR #239, checked at head `4346c0a` (CI green: checks, ci, e2e-mock, supabase).
- Tester files (test files only, no application code touched):
  - NEW `e2e-mock/t126-tester-mock.spec.ts` (36 tests).
  - `e2e-mock/t072-waiting-check-mock.spec.ts`: wait for CSS transitions to end before the dark-mode axe call (see F-1). The axe check is not loosened.
  - `e2e-mock/t069-recheck2-focus-mock.spec.ts`: wait for the header height to hold still before sampling the ring (see F-2). No threshold changed.

## Check results (evidence)
1. Suites
   - `npm run lint` clean; `npm run typecheck` clean; `npm test` 156 files, 3285 passed, 3 expected fail.
   - `npm run test:e2e:mock` (port 3101): first run 414 passed, 2 failed (F-1, F-2). After the test fixes and my 36 new tests: **452 passed, 0 failed**.
   - CI (run 40351667713, `gh pr checks 239`: checks, ci, e2e-mock, supabase all pass). From the supabase job log: RLS tests step "33 files, 467 tests passed"; API route tests "49 files, 876 passed"; "Playwright e2e (real routes) and smoke test" step "51 passed (3.5m)"; the bite-test step "demo step 1 fails without seeded photos" ran as designed (2 failed = the expected bite).
2. Light, dark, reduced motion at 320, 375, 1280 on `/` (new spec, 6 describe blocks x 5 tests = 30, plus 6 others, all pass):
   - Hover, click and tap (touch context, `.tap()`) open a pot; Enter and Space open a pot (all 3 pots, all widths, both schemes); one `.pot-btn.is-open` at a time; clicking the same pot twice keeps it open.
   - Tab order: every width and scheme, all "copy" stops come before the first "map" stop, "table" stops (if any) after the map; the three pots are Pho bo, Chole and roti, Brown stew fish in that order.
   - 320: `scrollWidth <= 320` and `scrollsSideways` false with a pot open. 44 px: every `.pot-btn` box >= 43.5 px at 320, 375, 1280.
   - Focus ring: computed outline is solid, >= 2 px (3 px) and >= 3:1 against `--map-land`, `--paper` and `--hero` in both schemes (also the pixel-sampling spec `t069-recheck2` passes after F-2).
   - `aria-live="polite"` on the card; every open state shows a DEMO badge; pot aria-labels say "(demo)"; PROTOTYPE badge visible. No MOCK/real claims seen.
   - No console error, pageerror or `securitypolicyviolation` event with a pot open and hover (font and resource-load noise excluded; CSP events are caught separately).
   - Reduced motion: no running CSS animation on lids or pot children at 375; transition 0 s on the open lid (builder spec).
3. Fallback link `/search?city=&cuisine=` (mock spec + builder spec): good link fills city and cuisine and runs the search; unknown city, `%00`, a 41-character cuisine, repeated `city`/`cuisine`, empty values, extra and `__proto__` params: ignored, no alert, no page error. A good link beats the saved form (saved Brampton/Indian, link for mississauga/Vietnamese gives "Mississauga"/"Vietnamese" with city matched ignoring case); plain `/search` then restores the saved form. Axe on the prefilled search in dark: clean.
4. Other pages: axe specs in the full mock run (search, chef, booking, admin, chat, signup) all pass in light and dark. I looked at screenshots of sign-up with errors (light and dark), search results (dark) and chef detail (dark): readable, no gingham. Errors show red text and red outline with a message, solid terracotta stays only for buttons, so they stay distinct. (Observation only: in dark the error red is salmon and the button is terracotta, closer in hue than in light; messages always carry text.)
5. Bite tests (each reverted with `git checkout`, tree clean after):
   | Break | Result |
   |---|---|
   | Seed dish name `Pho bo (beef` to `Pho bo X (beef` in `scripts/seed-data.ts` | `demo-pots.test.ts` 1 failed ("pots match the seed"): FAILS as required |
   | PotMap link forced to `"/search"` (both branches) | 6 PotMap tests fail, including "links to the chef when found" |
   | Only the fallback forced to `"/search"` (city and cuisine dropped) | 5 PotMap tests fail (fallback, slow lookup, fetch fail, non-OK, MOCK) |
   | `order: 1` on `.home-copy` | the computed-order e2e ("desktop puts the table under the words ... DOM order kept") FAILS. The keyboard tests do NOT fail: Chromium Tab follows the DOM, and grid areas ignore `order`, so nothing really moves. This is correct behaviour, so I did not force it. |
   | Real visual reorder: base `grid-template-areas` map, copy, table | "phone order 375" FAILS (3 of 3 repeats) and the desktop test fails too. Note: on a cold dev server the first load can use a stale stylesheet (the builder noted it); I repeated the run to get a warm server |
   | Dark pot tokens back to the light values (6 lines) | `theme-contrast.test.ts` "home map pots stand out from the land (3:1, non-text)" FAILS as required |
   | Each dark token alone | `--pot-lid-red` and `--pot-herb-lid` fail the test. `--pot-herb`, `--pot-bubble-bg`, `--pot-bubble-fill` and dark `--map-shadow` reverted alone are NOT caught (F-4, LOW) |
   | `searchPrefill` returns null | 3 unit tests fail; repeated params accepted: 1 fails; unknown city not filtered: 2 fail |
   | SearchView prefill effect disabled (`return` before use) | 3 e2e fail (pot link opens search ..., good link beats saved form, axe on prefilled search), twice each |
6. T-127 `tests/rls/contact-privacy-tester.test.ts`: read the diff. The four D-52 cases keep the same boundaries: (a) last day = fall-back day minus 8, hidden at 00:00 EDT of the change day (04:00Z); (b) last day = fall-back minus 2, hidden fall-back + 6 at 00:00 EST (05:00Z); (c) spring-forward minus 8, hidden at 00:00 EST of the change day (05:00Z); (d) spring-forward minus 4, hidden spring + 4 at 00:00 EDT (04:00Z). With today 2026-10-26 they become 2027-11-07 and 2027-03-14 (old offsets and instants are identical). The expected UTC instant is still computed independently of the database (Intl wall-clock match over -4 and -5 hours, throws if none matches). No assertion removed or weakened (same `it.each`, same comparison). I ran the helper logic in node for 7 "today" values (2026-10-24, 2026-10-26, 2026-11-01, 2027-03-05, 2027-03-06, 2027-11-06, 2028-12-31): never throws, always picks a future change and the right offset. The RLS file itself ran green in CI today (467 passed). Remaining fixed dates elsewhere in that file are already recorded in lessons-learned.
7. `t072-waiting-check-mock` dark axe on the chat Send button: **not a harmless flake and not on main.** On `origin/main` (separate checkout, `npm ci`, port 3101 after my main run): 20 of 20 pass (`--repeat-each=5`). On this branch it failed 3 of 3 re-runs and in both full runs. Cause: see F-1. After the test fix: 20 of 20 pass on this branch.

## Findings
- **F-1 (MEDIUM, fixed in test): the colour flip exposes a half-way contrast.** `e2e-mock/t072-waiting-check-mock.spec.ts:~100`. Repro: load the booking page in light, `emulateMedia dark`, run axe at once. `.btn` text flips instantly to dark ink (`--on-primary` #1e1611 in dark) while `background-color` transitions for 160 ms (`globals.css:~330`) from light-mode #a5482a to dark #e3825c, so axe reads dark ink on mid clay (about 2.9:1) and reports `color-contrast`. On main both modes use light text, so it never showed. Real users only see this for 160 ms when the OS theme switches with the page open. I made the test wait for `document.getAnimations()` to finish (the same axe call, nothing loosened). Optional app-side polish for the builder: add `color` to the `.btn` transition list or drop it in dark. Needs the Reviewer's call; not blocking.
- **F-2 (LOW, fixed in test, pre-existing):** `e2e-mock/t069-recheck2-focus-mock.spec.ts` "/ light 375" failed once in the full run and 4 of 40 under 6 workers. Cause: at 375 the `<header>` grows from 94 to 153 px about 285 ms after load (on `origin/main` too: hero y 96 to 155), so the pixel sampler measured a moved ring. I added a wait until the header height holds. After: 40 of 40 pass with 6 workers. App-side, a 59 px layout shift of the whole page at 375 px is a small CLS problem on every page (not from T-126). Suggest a later ticket.
- **F-3 (LOW, observation):** the `order: 1` bite on `.home-copy` is not caught by the keyboard tests, only by the computed-order test, because `order` does not change Tab order in Chromium and has no effect on a grid with explicit areas. The WO wording "order/keyboard tests must fail" is therefore only half true; the guards that matter (computed order 0, phone order, DOM order) all work.
- **F-4 (LOW):** `src/app/theme-contrast.test.ts` does not cover dark `--pot-herb`, `--pot-bubble-bg`, `--pot-bubble-fill` and `--map-shadow` (reverting one of them alone passes). Lids and the pot body are covered. Cosmetic risk only.
- No HIGH findings. No new console, CSP or sideways-scroll problem found. Note: the Playwright mock config reuses the dev server only when it starts fresh; a cold first load may show a stale stylesheet (builder's note); repeat-run when bite-testing CSS.

## Known gaps or risks
- Real routes (pot link to the real chef id) are covered only by the CI real-route spec (`e2e/t126-home-real.spec.ts`, passed in CI), not run locally.
- A real touch device was emulated with Playwright, not a phone.
- No Safari or Firefox run.

## What the next agent needs
- Reviewer: look at F-1 (optional app polish) and F-4. Re-run is cheap: `npx playwright test -c playwright.mock.config.ts e2e-mock/t126-tester-mock.spec.ts` (36 tests, about 15 s).
- This handoff and the new spec trigger CI again when pushed (the PR has `ci` required); nothing else changed in application code.
