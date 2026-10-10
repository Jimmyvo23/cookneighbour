# Handoff: T-040 Search and results UI with map

From: frontend  To: tester

## What changed
- Branch: `feature/T-040-search-ui`
- Pull request: #89 (Closes #28). CI run 38056439811 green on head 782d186.
- **Search page** `/search` (public, linked from the home page): `src/app/search/page.tsx`, `src/components/search/SearchView.tsx` (form, results, Load more, map toggle), `ResultCard.tsx`, `ChefMap.tsx` (Leaflet, client only), `ResultsMap.tsx` (`next/dynamic`, `ssr: false`), `map.css`.
- **Client logic** `src/lib/search/search.ts` (+ 30 tests): form to query (dollars to whole cents with the existing `dollarsToCents`, empty values dropped, postal code wins over city), quick validation (GTA postal code against the loaded prefixes, rates 0 to $1000 and order, date inside today..today+180), `mergePage` (cursor paging without repeats, first new id for focus), formatting, map pins (`buildPins`, `searchPoint`).
- **Mock adapter** `src/lib/mocks/mock-search.ts` (+ 17 tests), wired first in `mockFetch` so no session is needed: the three section 7 routes, 22 made-up approved chefs (8 real-looking, 14 fillers so "Load more" has a second page), reusing `parseSearchQuery` and `rankChefs` from `src/lib/domain/search.ts`. Differences from the real route: the cursor is an offset `m<number>` (the real one needs Node's `Buffer`, same reason as mock-admin); the date filter uses made-up weekdays; a 15-row copy of the GTA table. Magic input: cuisine `explode` gives 500.
- **Chef page placeholder** `src/app/chefs/[id]/page.tsx` so result links do not 404. **T-041 replaces this file.**
- **T-036 backlog:** `ChefReviewView.reload()` returns `"ok" | "failed" | "superseded"`; superseded sets no "may have expired" notice and no "Could not reload" flash; `manualReload` returns early while refreshing (a ref, because the button is only `aria-disabled`). `ChefQueueView` says "Signed up".
- **Tests:** `e2e-mock/search-mock.spec.ts` (10), `e2e/search-real.spec.ts` (4, added to `testIgnore` in `playwright.config.ts` when there is no local stack).
- `src/app/page.tsx`: link "Find a home cook".

## New dependencies and licences
- `leaflet` 1.9.4, BSD-2-Clause, free and open source (runtime).
- `@types/leaflet` 1.9.22, MIT (dev only).
- `react-leaflet` not needed (Leaflet used directly in one effect-based component).
- Map tiles: OpenStreetMap standard tile server. Data licence ODbL, attribution "(c) OpenStreetMap contributors" with link to openstreetmap.org/copyright is shown on the map. The public tile server is for light use only (its usage policy forbids heavy traffic); fine for the prototype, a real launch needs a tile provider.

## How to verify
- `npm run lint`, `npm run typecheck`, `npx prettier --check .`, `npm test` (853 tests in 43 files; 47 of them new), `npm run build`, `npm run test:e2e:mock` (77 passed, 10 new in `search-mock.spec.ts`).
- Real routes need Docker and the local Supabase (not on the builder's machine): ran in CI only. Run 38056439811: unit 853, RLS 118, API 403, real Playwright 27 passed (4 new), mock Playwright 77 passed.
- By hand: `NEXT_PUBLIC_API_MOCK=1 npm run dev`, open `/search`, choose city Mississauga and cuisine Vietnamese, press "Find chefs".

## Known gaps or risks
- **Pins are per city, not per chef.** Contract section 7 hides a chef's postal area, so the API gives only `serviceCity`. A pin sits at the average of that city's area centres (the A-18 city point) and its number is how many listed chefs work around that city. Per-area pins would need the contract to expose the area centre (the Reviewer already noted that distance leaks it); Planner decision.
- **Date limits use the browser clock** (Toronto time via `torontoToday()`), read after mount; the search response has no `today`. The server's 422 stays the authority and is shown beside the date. A visitor with a wrong clock may see a slightly shifted window.
- The date filter does not remove booked dates yet (T-042); the page says so.
- The "dietary" filter is allergen exclusion only; the page says so and that it is not an allergy guarantee (A-17, Q-18).
- The map starts collapsed under 1024 px and open above it (decided once after mount, not on resize). Leaflet animations are off on purpose.
- Pin click uses a native key handler (Enter and Space) because Leaflet turns Enter into a click only for popups.
- A failed search clears the previous results (the form keeps its values).
- Server 422 field errors are only reachable in the real run when the postal list did not load (the page's own check is stricter than the server). The real spec covers it by aborting the prefixes request. The mock cannot show a server 422 for the same reason.
- Profile photos load straight from the public `profile-photos` bucket URL; without `NEXT_PUBLIC_SUPABASE_URL` or when the file fails, an initial letter is shown (hidden from screen readers; the name is beside it). In MOCK mode there are no photos.
- Tile requests: mock tests answer them with a 1 px picture (no network). Real-route tests do not open the map.
- `NEXT_PUBLIC` dev badge can sit over a bottom-left button in `next dev`; the mock spec hides it with a style tag.

## What the next agent needs
- **T-041:** result links go to `/chefs/<uuid>` (`chefPath()` in `src/lib/search/search.ts`). Replace the placeholder file. The mock has `GET /api/chefs/:id` with dishes and weekday-based `bookableDates`; the 8 named chefs have dishes, the fillers have one. Photos: `profilePhotoUrl()` (profile-photos bucket) here, `dishPhotoUrl()` in `src/lib/chef/dishes.ts` for dishes. Reuse `ALLERGEN_CHOICES`, `formatDollars`, `eatByText`.
- **Tester:** try a hand-edited `/search` (there is no URL state, so nothing to tamper), double-clicking "Find chefs" and "Load more", changing the form while a page is loading (the list must not mix queries; paging uses the last submitted query, not the form), a 375 px layout with long names, keyboard on the map pins (Tab, Enter, Space) and `prefers-reduced-motion`, a city name with a space ("Richmond Hill"), a rate like `0`, `0.5`, `1000`, `1000.01`, and the date at both ends of the window. In the mock, `cuisine=explode` shows the 500 state. Check the T-036 reload change by clicking "Reload application and file links" twice quickly: no "Could not reload" and no "links may have expired" notice should appear when nothing failed.
- Lessons-learned candidate: Leaflet's `keyboard: true` markers get `tabindex` and `role=button` but no accessible name for `divIcon` (set `aria-label` yourself) and Enter does nothing without a popup.

## Round 2 (Tester findings)
- Fix 1: in MOCK mode the photo URL is skipped (`isMockEnabled()`), so the fallback shows and hosted storage is never asked for made-up paths. Same leak found and fixed in `src/components/chef/DishesView.tsx` (dish photos). `e2e-mock/search-mock.spec.ts` now blocks `**/storage/v1/object/public/**`. Chef pages (T-041) must do the same.
- Fix 2: `mock-search.ts` returns the normal 404 for a malformed percent escape; `it.fails` in `mock-search-tester.test.ts` is now `it`.
- Checks: lint, typecheck, 924 unit tests, 98 mock Playwright all pass locally.
