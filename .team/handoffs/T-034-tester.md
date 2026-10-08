# Handoff: T-034 Dish menu and availability calendar UI

From: tester  To: planner (then reviewer)

## Verdict: PASS (no blocking findings; 4 non-blocking findings for the Reviewer or follow-ups)

## What changed (tests only, no app code)
- Branch `feature/T-034-dish-menu-availability`, PR #77. Tester commit `92a0ed5` on top of builder head `f297fc2`.
- Added: `src/lib/chef/dishes-edge.test.ts` (54 tests: dollars to cents edges, D-16 bounds, unsafe text, allergens, time-zone independence and Toronto midnight), `src/lib/mocks/mock-adapter-order.test.ts` (7: exact route check order), `e2e-mock/chef-t034-tester-mock.spec.ts` (7: Toronto window in three foreign browser zones, Home/End and one tab stop, non-colour pressed cue, clear a saved day, 500.00 / 500.01 / 0 cents round trip, T-033 wording).

## Results
- Local: `npx prettier --check .`, `npm run lint`, `npm run typecheck`, `npm run build` all clean. `npm test`: 385 passed (323 builder + 62 tester). `npm run test:e2e:mock`: 36 passed (29 + 7).
- CI on tester head `92a0ed5`, run 37831533906, all steps green: unit 385, RLS 115, API 261, Playwright real routes 17, Playwright mock 36. The builder head `f297fc2` was also green (run 37826030974: success).

## Findings
1. LOW (accuracy of the handoff, wasted storage) `src/components/chef/DishesView.tsx` save catch block (`uploaded.current = null` inside the `catch` around the PATCH/POST). The builder handoff says an uploaded photo is reused if only the save failed. The code throws the upload away on ANY save error (network drop, 409 cap, 422 on another field), so each retry uploads a new file and leaves an orphan in `dish-photos`. Not a security or data bug (orphans are in the chef's own folder, upsert false). Either keep the path for errors that are not about `photoPath` (403/422 on photoPath), or fix the handoff and README known limits (T-054).
2. LOW (accessibility, visual) `src/components/chef/AvailabilityView.tsx` Prev/Next month buttons use `aria-disabled` at the ends of the window but have no visible disabled style (the classes only style the `disabled` attribute). Same for the Edit/Deactivate buttons while busy. A sighted user cannot tell the month button is inactive. Add a `aria-disabled:opacity-60` class.
3. LOW `src/lib/domain/dishes.ts` `allergenList` (line ~60): the 14-entry limit counts entries before duplicates are merged. A chef with 13 ticked allergens who also types "celery, Milk" (Milk repeated) gets "Up to 14 allergens" although only 14 distinct entries exist after merging. Rare; documented by a test in `dishes-edge.test.ts` ("counts duplicates against the limit").
4. INFO `src/lib/domain/text-safety.ts:8-11` (shared T-059 rule): bidi overrides (U+202E) and C1 controls (U+0080 to U+009F) pass the "unsafe text" rule, so a dish name can contain a right-to-left override. Spec says only control characters and lone surrogates; recorded for the Reviewer and a possible hardening item (WO-8).
5. INFO `/chef/*` for anonymous visitors returns HTTP 200 (a Next 16 streamed shell), not 307: the redirect is a streamed `NEXT_REDIRECT;replace;/login;307` plus `<meta http-equiv="refresh" content="1;url=/login">`. The raw HTML holds only the "Loading..." fallback and the `<title>` ("Your dishes - CookNeighbour"); no dish, calendar, nav or application content. Same pattern T-033 shipped. Search-engine bots see 200 with `noindex`.
6. INFO Handoff statement "real-route RLS/API suites ran in CI only" confirmed: they are green in CI on the current tester head.

## Checked and OK
- Guard: `src/app/chef/layout.tsx` runs `requireChefPage()` (fail closed: only UNAUTHENTICATED becomes a redirect, anything else throws) before `ChefNav` and children. Built and served `next start`: raw HTML of `/chef/dishes`, `/chef/availability`, `/chef/apply` for an anonymous request has no chef content. Customer path is covered by `e2e/chef-dishes-real.spec.ts:69` (raw HTML, redirect to `/`). Admin uses the same `chefPageRedirect` (role not chef goes to `/`); no live admin raw-HTML test exists (the real spec has no admin case, and admin needs a seeded account). Gap noted, not a bug.
- Dollars to cents: 0, 0.00, 0.5, 500, 500.00, 499.99, "$25.5", padded spaces accepted; 500.01, negatives, 0.001, 25.505, 1e3, NaN, Infinity, "", ".5", "25.", "1,000", 7+ digits, Arabic-Indic digits refused with the dollar message. D-16 edges (5/360, 1/50, 0/7, 120/40/1000 characters) accepted and one past refused.
- Mock adapter order matches `src/lib/server/dishes.ts`: role, 404 (PATCH) before everything, unknown keys alone (even with bad fields and a foreign photo), foreign photo 403 before fields, field rules plus a badly named own photo together, then the 409 cap (field errors win). Empty PATCH is a no-op; re-sending `isActive: true` at the cap is 200 (DB trigger excludes the row itself). `isActive` is unknown on create.
- Photo upload: bucket `dish-photos`, path `<uid>/dish-<uuid>.<ext>` lower case, `upsert: false`, error text hides storage details, fallback box for missing or broken photo, "Anyone with the link can open dish photos" is true.
- Calendar: only strings are used, no browser clock. With the browser in Pacific/Kiritimati, Pacific/Pago_Pago and Asia/Tokyo and the clock at 23:30 Toronto, today is shown as Toronto's day. Unit tests prove the Toronto day flips at 04:00Z (EDT) and 05:00Z (EST) in any machine zone. PUT sends only `{add, remove}`; keyboard (arrows, Home/End, PageUp/PageDown, Space, Enter), one tab stop, aria-pressed plus check mark and unsaved dot, 375px and axe (light and dark) are clean.
- T-033 carry-overs: "Draft wording" gone, "This is not legal advice." and "MOCK: nobody checks this in the prototype" kept, "dish editor not available" gone, "sends its check back to pending review" used, MOCK badge on ID, certificate and police statuses. Removed-photo wording ("also tries to delete the file (if that fails, the file may stay stored)") is TRUE: `src/lib/server/chef-application.ts:529` calls `removeObject` after the database update, and contract section 5 says the failed delete only leaves an orphan. It promises nothing false. The PLAN T-033 line ("the file stays stored") is the one that is wrong and should be corrected by the Planner.

## Known gaps or risks
- No admin raw-HTML guard test (needs a seeded admin in the real-route suite).
- The upload-retry behaviour (finding 1) has no automated test because the MOCK uploader cannot observe a second upload.
- Browser-zone tests run in MOCK mode only (the mock adapter plays the server); the real server uses `torontoToday` which is unit tested.

## What the next agent needs
- Reviewer: look at findings 1 to 5. None blocks the merge in my view; 2 is a one-class fix.
- Planner: after merge nothing new for Supabase (no migration in T-034). Correct the PLAN T-033 follow-up wording about removed kitchen photos.
