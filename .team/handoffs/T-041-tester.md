# T-041 Tester handoff

**Task:** T-041 Chef detail page (PR #90)
**Verdict:** PASS on head f9f30d4 (CI run 38065886581 green: lint, typecheck, vitest, RLS, API, real-route Playwright, mock Playwright, build)
**Written by:** Tester

## Counts
- Local: lint clean, typecheck clean, `npm test` 47 files, 964 passed + 2 expected-fail (it.fails, see findings 1 and 2), `npm run build` ok, mock Playwright 120 passed (builder's 105 + 15 mine).
- Added by me (tests only, pushed in f9f30d4): `src/components/chefs/ChefDetailView.tester.test.tsx` (27, real apiFetch with a stubbed fetch), `e2e-mock/chef-detail-tester.spec.ts` (15), one real-route test appended to `e2e/search-real.spec.ts` (rejected chef 404; approved chef without kitchen review). The real-route test ran green in CI only (no local Supabase).

## Verified (no defect found)
- Privacy: exactly one request, GET `/api/chefs/:id` (id URL-encoded); Book stub makes no request (unit and e2e). Hostile API answer (markup/script in name, bio, cuisines, languages, city, dish name/description/cuisine/allergen; extra keys address, phone, email, kitchen photos, police status, postal code, user id, dish note) renders as literal text, no script/onerror element, no `window.__pwned`, none of the extra keys shown. No storage request in MOCK mode. Chef's home only when the API lists it, with the MOCK check note and "address is not shown".
- Allergens: words in a box with "Contains: ..." (14 allergens all written out); "No allergens listed by the chef", no "free" wording anywhere; cents to dollars ($30.05, $0.05); eat-by days singular/plural.
- Dates: from `today`/`lastBookableDay` (browser clock set to 2031 changes nothing); groups across month and year end; junk, impossible and duplicate dates dropped; empty list message; booked-days note present.
- States: 404 with JSON, non-JSON or empty body all give one "Chef not found" (h1, title); 500, 503, 429, 400 and network errors give the retry state without server text and Try again recovers; `locationOptions: []` shows neutral "cannot be booked yet" (no rejected/pending/hygiene words, no kitchen note); stale-response guard works; headings H1, H2 sections, H3 dishes in order.
- Saved search: bad JSON, array, wrong version, wrong types, 201-char field, 40 allergens, unknown location type all ignored (empty form, no alert). A script string in a saved field stays text, the server rejects it, a message shows and the saved search is dropped; a past date likewise. Only a search that ran is saved (invalid submit and unsubmitted typing are not). sessionStorage is per tab: a second tab and a reopened tab start empty.
- T-040 carry-overs: A-25 label follows the query; MOCK note on the kitchen filter; ChefReviewView comment fixed.
- Accessibility: axe light and dark, 375 px no overflow, Back link first Tab stop in the content (after the site header's Log in and Sign up), month `details` open with Enter, Book stub focusable and inert.

## Findings
1. LOW `src/lib/search/search.ts:233` and `src/lib/chef/dishes.ts:~170` (`profilePhotoUrl`, `dishPhotoUrl`): `encodeURIComponent` does not encode "..", so a photoPath such as `../../x.png` resolves in the browser to `/storage/v1/object/x.png`, outside the bucket folder. Only a tampered API answer reaches it (the server keeps paths in the owner's folder), so defence in depth. Fix: drop or reject dot segments. Recorded as `it.fails` in `ChefDetailView.tester.test.tsx`; remove `.fails` when fixed.
2. INFO `ChefDetailView.tsx:203-206`: a 200 answer that breaks the contract shape (no arrays) throws during render. No `error.tsx` exists, so the user sees a crash instead of the retry state. Only a broken server sends it. Recorded as `it.fails`.
3. INFO Judgement on "a later visit to /search restores the last search": acceptable for the demo. It only restores a search the user actually ran in that tab (tested), never leaks across tabs, and clears itself when it cannot repeat. A user may be surprised after typing /search directly, with no way to clear it except Find chefs with new values. Suggest a "Clear search" button or restoring only on back navigation, as a later polish (not blocking).
4. INFO `src/lib/search/search.ts:278`: saved text fields allow 200 characters while the form limit is 40 (TEXT_MAX). Harmless: restoring skips local validation and the server answers 422 and the saved search is dropped. Align the two to keep one rule.
5. INFO The page has no skip link (site header Log in and Sign up come before content); existing layout, not T-041.
6. INFO Not verified: where keyboard focus lands right after clicking a result link to the chef page (Next default behaviour, not checked in a screen reader).

## Not covered
- Local run of the real-route and RLS/API suites (no local Supabase); relied on CI run 38065886581 on the current head f9f30d4.

## Round 2 (head 469ab02, CI run 38068007447 green)
**Verdict:** PASS. Builder head was 0436991; I added tests only on top (469ab02).

- Finding 1 (dot segments) fixed: `isSafeStoragePath` rejects empty, ".", "..", leading slash, backslash, control characters; both URL builders return null and the page shows the fallback. The builder's rewritten test still tests the right thing (no img src containing the file, chef photo fallback shown). New `src/lib/chef/storage-path.tester.test.ts` probes 16 rejected and 10 accepted paths. Percent-encoded (`%2e%2e`, `%2F`, `%252e`), double-encoded and unicode dot look-alikes (fullwidth, one-dot leader) pass the check but are encoded to literal text, so the URL stays inside the bucket with no query or hash.
- Finding 2 (shape crash) fixed: `isChefDetail` plus `error.tsx`. 15 new shape-break tests (null arrays, number in languages, null dish, null allergens, wrong dish types, null bio or photoPath, missing today, answer is array, null or string) all show the retry state.
- NEW INFO 7 `src/lib/search/detail.ts:80-114`: `isChefDetail` does not check dish `photoPath`/`description` types or `serviceCity`. A wrong type there (number photoPath, object description or serviceCity) still throws in render; in the real app the new `error.tsx` catches it, so it is no longer a blank screen. Recorded as 3 `it.fails` ("KNOWN GAP"). Not blocking: only a broken server sends it. Also `hourlyRateCents` as a string does not crash.
- Counts: lint, typecheck, build clean; vitest 48 files, 1012 passed + 3 expected-fail; mock Playwright 120 passed; CI (lint, typecheck, vitest, RLS, API, real-route, mock Playwright) green on 469ab02.
