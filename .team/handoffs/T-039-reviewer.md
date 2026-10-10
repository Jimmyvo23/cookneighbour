# T-039 Reviewer handoff

**Task:** T-039 Search API (PR #85)
**Verdict:** APPROVE on head 78e5669 (comment 6093146480; CI run 38018907849 green)
**Written by:** Planner, from the Reviewer's report (D-7)

## Confirmed
- Pending and rejected chefs never shown: `.eq("status","approved")` in both queries (`src/lib/server/search.ts:107,164`), seven viewer kinds tested; one identical 404 (status, body, headers) for non-uuid, unknown, pending, rejected and A-20-hidden.
- Privacy: named columns, exact key sets tested; no address, phone, email, kitchen photos, check statuses or hashes; anon-capable client only.
- Discrimination guard: only cuisine and language filters (CLAUDE.md §6.3).
- No PostgREST filter string built from input; strict cursor decode; a forged cursor cannot reveal a hidden chef.
- A-1, A-17, A-18 reuse the T-037 domain functions; A-19 and the D-15 window correct with edges; A-20 hides in search and detail.
- Caching: search, detail and errors `no-store`; only postal-prefixes is public-cacheable (cookie-free, same data for all).
- Admin `await connection()`: `requireAdmin` still the first data await; guard test adjusted correctly.
- Contract v1.3 and types match the code; scope matches WO-4a T-039 plus the T-036 backlog item.

## Findings (none blocking)
1. LOW, question for Jimmy (Q-21), `src/lib/server/search.ts:205-212`: a chef offering only an unenabled chef's home is hidden from search but detail returns 200 with `locationOptions: []`. Reviewer recommends the same 404 (add "no bookable location option" to the A-20 rule). If kept, T-041 needs a "not bookable yet" state. The pinned tester test and the contract change together.
2. INFO `docs/api-contract.md:272`: says the chef's postal prefix is never shown; it is never returned, but the service-area centre can be inferred from `distanceKm` (0.1 km steps) over a few searches. Area centre only, never an address; soften the wording.
3. INFO `src/lib/domain/search.ts:302`: explicit `locationType=customer_home` still returns `chefHomeOnly` chefs (A-18); T-040 must label or filter them.
4. INFO `search.ts:42,114`: silent cut-off above 1000 approved chefs (documented).
5. INFO `admin-chefs-guards.test.ts:136`: strips only the first `await connection();`; the tester's extra guard covers it.

## Follow-ups
- T-040: postal-prefixes for the city picker and map pins (area centres only); chef's-home-only label; list is the main view and works without the map; 422 field errors next to inputs with focus; mock adapter routes per §7 incl. cursor paging.
- T-041: one "Chef not found" state for every 404; handle `locationOptions: []` if Q-21 keeps it; use `today`/`lastBookableDay` from the response; allergens on each dish; public route only.
- T-042: remove booked dates from the `date` filter and `bookableDates`; re-check approved, `chef_home_enabled` and radius at booking time; hidden chef → same 404 (`CHEF_NOT_BOOKABLE`).
