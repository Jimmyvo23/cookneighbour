# T-040 Reviewer handoff

**Task:** T-040 Search and results UI with map (PR #89)
**Verdict:** APPROVE on head d0d1a6e (comment 6099010296; CI run 38061211269 green)
**Written by:** Planner, from the Reviewer's report (D-7)

## Confirmed
- Privacy: cards show only contract §7 fields; map pins at the average of a city's area centres; pin HTML is a number, city name set via `setAttribute`; no storage URLs in MOCK mode (also fixed in `DishesView`).
- Discrimination guard: cuisine and language only; no nationality filter or wording.
- Honesty: allergen filter is not an allergy guarantee; unsupported diets and not-yet-removed booked days stated; mock chefs labelled "(MOCK)".
- Correctness: whole cents, Toronto date limits, cursor Load more, stale responses dropped, server 422 next to inputs with focus.
- Accessibility: named pins, Enter/Space, list works without the map, 375 px, axe.
- Mock adapter reuses the real search and ranking functions; differences documented. T-036 backlog done. leaflet 1.9.4 (BSD-2-Clause) locked, OSM attribution shown. `/chefs/[id]` placeholder static. No backend, contract, migration or domain edits.

## Findings (none blocking)
1. LOW `src/components/search/SearchView.tsx:624`: list label "Chefs, nearest first" is wrong without a location (rating order, A-25). Fix in T-041.
2. LOW, MOCK honesty `SearchView.tsx:411`: "Only chefs whose kitchen an admin has approved" needs a MOCK note (kitchen review is mocked, §6.7). Fix in T-041.
3. INFO `SearchView.tsx:205-219`: a server 422 on `locationType` would highlight no field (not reachable from the form).
4. INFO `src/lib/search/search.ts:253-277` `buildPins`: a one-area city would pin that chef's area centre (seed has at least 4 per city; `distanceKm` already exposes it). Note in contract/README or skip pins for cities with fewer than 2 areas.
5. INFO `src/components/search/ChefMap.tsx:12`: public OSM tile server fine for a light demo; before WO-7 make the tile URL configurable, add a README limit, allow the host in any future CSP.
6. INFO: mock-adapter and mock-admin unit tests time out on a busy machine (also on main). Candidate for T-051.
7. INFO `src/components/admin/ChefReviewView.tsx` `afterChange`: comment "True when it loaded" now inaccurate (also true when superseded).

## Follow-ups
- T-041: replace the placeholder; one "Chef not found" state for every 404; no storage URLs in MOCK mode; handle `locationOptions: []` (Q-21); `today`/`lastBookableDay` from the response; allergens on each dish; public route only; MOCK wording on the kitchen option; findings 1, 2 and 7.
- T-042: remove booked dates from the date filter and `bookableDates`, then update the page text; re-check approved, `chef_home_enabled` and radius at booking time.
- README / WO-7: OSM tile limit; one-area-city pin note.
