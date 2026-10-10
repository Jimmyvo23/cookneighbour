# Handoff: T-041 Chef detail page

From: frontend  To: tester

## What changed
- Branch: `feature/T-041-chef-detail`
- Pull request: https://github.com/Jimmyvo23/cookneighbour/pull/90 (Closes #29)
- CI: run 38064529801 green on the first head (cd5dce9): vitest 939, RLS 118, API 403, real-route Playwright 40, mock Playwright 105.
- Added: `src/components/chefs/ChefDetailView.tsx` (the page, client component, reads only `GET /api/chefs/:id`), `src/lib/search/detail.ts` (+ test: month grouping, short day labels, allergen words, location labels, bookable check), `e2e-mock/chef-detail-mock.spec.ts`.
- Changed: `src/app/chefs/[id]/page.tsx` (placeholder replaced); `src/lib/mocks/mock-search.ts` (+ test: Mai Tran has 4 dishes incl. a 3-allergen dish and one with no allergens, first dish of each chef has a photo path that falls back; new `MOCK_NOT_BOOKABLE_CHEF` Nadia Petrova, id `...-000000001050`, only reachable by URL, never in search); `src/lib/search/search.ts` (+ test: `resultsOrderLabel`, `serializeForm`/`parseSavedForm`, `SAVED_SEARCH_KEY`); `src/components/search/SearchView.tsx` (list label follows the query, A-25; MOCK note on the chef's-home filter text; last search saved in `sessionStorage` and repeated on mount); `src/components/admin/ChefReviewView.tsx` (comment only); `e2e-mock/search-mock.spec.ts` (placeholder assertion updated); `e2e/search-real.spec.ts` (3 new or extended tests).
- Not touched: backend, contract, migrations, `src/lib/domain/*`.

## How to verify
- `npm run lint && npm run typecheck && npm test && npm run build`
- `npm run test:e2e:mock` (105 pass; 7 new in `chef-detail-mock.spec.ts`)
- Real route (needs local Supabase, not available on my machine; passed in CI): `npx playwright test e2e/search-real.spec.ts`
- By hand in MOCK mode (`NEXT_PUBLIC_API_MOCK=1 npm run dev`): `/chefs/00000000-0000-4000-8000-000000001001` (Mai, both locations), `.../000000001050` (not bookable), `/chefs/xyz` (not found).

## Known gaps or risks
- Booked days are not removed from the dates (no bookings yet); the page says so. Update the text in T-042.
- Book is a stub: `aria-disabled` button "Booking opens soon", does nothing. Q-21 is open; `locationOptions: []` shows "This chef cannot be booked yet" (neutral wording), and the stub hint says the same.
- Saved search uses `sessionStorage` (per tab). A fresh visit to `/search` in the same tab restores the last search too. If storage is blocked the search still works. If the repeat fails (for example a stale date) the saved search is dropped and a message asks to press Find chefs; no focus is moved.
- A malformed percent escape in the URL (`/chefs/%E0%A4%A`) is answered by Next.js itself before the page runs, so it is not covered in e2e (the mock adapter unit test covers the 404 mapping).
- The page is a client component fetching in the browser (like search). No server-side metadata per chef; the tab title is set after load.
- Playwright treats `aria-disabled` buttons as not enabled; specs click with `force: true`.

## What the next agent needs
- Tester ideas: sessionStorage tampering (`cookneighbour.search` with bad JSON, huge lists, wrong types: parser returns null); chef text with HTML (rendered as plain text); a dish with 14 allergens or a very long name at 375 px; `bookableDates` empty; offline or 500 on the detail route (error state with "Try again"); two quick navigations between chefs (stale response guard `seq`); screen reader order of headings (h1 name, h2 sections, h3 dishes).
- T-042 (booking): enable the Book button when `locationOptions.length > 0`; remove booked days from `bookableDates` and the page text; decide Q-21 (same 404 vs. current state; remove the "not bookable" state if the API changes). The mock adapter needs the same change.
- Allergen display is words plus a warning sign in a bordered box (not colour only); "No allergens listed by the chef" never says "free".
- Photos: `NEXT_PUBLIC_API_MOCK=1` never builds a storage URL; the mock specs abort and count `**/storage/v1/object/public/**` requests (expected 0).

## Round 2 (after Tester round 1)
- Fix 1: new `isSafeStoragePath` (`src/lib/chef/dishes.ts`) rejects empty, `.` and `..` segments, a leading slash, backslashes and control characters. `profilePhotoUrl` and `dishPhotoUrl` return null for such a path, so the page shows the photo fallback. Tester's `it.fails` is now `it` (asserts no image uses the path and the fallback shows). Unit test added in `detail.test.ts`.
- Fix 2: `isChefDetail` (`src/lib/search/detail.ts`) checks the 200 answer's shape; a bad shape shows the retry state. Added `src/app/chefs/[id]/error.tsx` as a last-resort boundary. Tester's second `it.fails` is now `it`.
- Skipped the optional "Clear search" control (not small enough to add without a design decision; left for later).
- Checks: lint, typecheck, build clean; vitest 967 pass; mock Playwright 120 pass.
