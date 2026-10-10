# Handoff: T-039 Search API (Tester)

From: tester  To: planner (then reviewer)

## Verdict: PASS (no blocking bugs; 3 low/info findings)

- Branch `feature/T-039-search-api`, PR #85, head **52c8d27** (builder head 17f4781 + my tests commit).
- CI run **38018071523** on headSha 52c8d27: success (lint, typecheck, unit, RLS, API, build, Playwright inside `ci`). Builder's earlier run 38017215024 on 17f4781 also green.
- Local: lint clean, typecheck clean, `npm test` 756 passed in 38 files (735 before + 21 new), `npm run build` ok: no prerender or cookies() error logged; /api/chefs, /api/chefs/[id], /api/reference/postal-prefixes and /api/admin/chefs are dynamic.
- DB suites (RLS/API) not run locally (CI only, as instructed). My 12 new API tests (tests/api/search.test.ts, appended) ran green in the CI run above.

## Tests added (tests only, no app code)
- `src/lib/domain/search-tester.test.ts` (21 unit tests): D-15 window edges, postal letter rules (D F I O Q U, bad first letter, 4-char, trailing char), blank values, both postalCode and city, city case/accents/NUL, limit forms, avoidAllergens normalisation, cursor tampering (12+ shapes), forged cursor harmless, full ties paging, chef removed between pages, null-distance ordering, radius boundary, unenabled chef's home hidden, static source guards (no service-role import, `.eq("status","approved")` exactly twice, is_active/available filters, no private column names or writes in server/search.ts, `await connection();` is the first await in all three routes, admin guard transform still fails when requireAdmin is removed).
- `tests/api/search.test.ts` (+12 API tests): 404 identical in status, body and all headers for non-uuid, unknown, pending, rejected, no-bio; unenabled-chef's-home-only behaviour pinned; today and today+180 accepted, +181 422; limit 002; odd limits 422; forbidden postal letters; accent/NUL city; comma-only avoidAllergens; real radius boundary through the DB; cursor tampering 422 and forged cursor never reveals a pending chef; four-way tie paging with limit 1; postal-prefixes identical for a signed-in caller, cache header, no Set-Cookie.

## Verified OK (no change needed)
- Pending/rejected never in list or detail for 7 viewer types (builder test) plus status filter present in both queries; anon-capable user client only (`createClient`/supabase-js with publishable key); no service role anywhere in these files.
- Exact key sets for list item, detail, dish; no address/phone/email/kitchen/check/hash strings.
- A-18/A-1 distance order (postal, prefix, city), chefHomeOnly only when approved AND chef_home_enabled, locationType both ways; A-17, A-20, price, language, cuisine, date, paging, strict 422s, limit bounds.
- `await connection()`: build log clean; admin gate is first await after it; adjusted guard test still catches a missing requireAdmin (my simulation). `tests/api/setup.ts` mock only replaces `connection()` (a no-op), keeps all other `next/server` exports via importOriginal; the real build proves the prerender behaviour, so it hides nothing material.

## Findings
1. LOW (design inconsistency, decision for Planner) `src/lib/server/search.ts:174-195` and `src/lib/domain/search.ts:291-305`: a chef offering only chef_home with chef_home_enabled=false is hidden from search (every filter combination) but `GET /api/chefs/:id` returns 200 with `locationOptions: []`, so the page exists but cannot be booked. Consistent with the builder's stated rule "only A-20 hides detail", but inconsistent with search. Pinned by a test; if the Planner changes the rule (404 or add to A-20), that test and the contract need updating. Frontend T-041 must handle an empty options list.
2. INFO `src/lib/server/search.ts:99-137`: list reads max 1000 chefs then filters in code (documented). Above 1000 approved chefs the list silently truncates; fine for prototype.
3. INFO `src/lib/domain/search.ts:117-131`: unknown query parameters are ignored while repeated known ones are 422 (documented in contract). `limit=007` accepted as 7, `postalCode=L 5 B` accepted (whitespace stripped). Harmless, recorded so the contract reader is not surprised.
4. INFO `src/lib/domain/admin-chefs-guards.test.ts:134`: guard strips only the first `await connection();` textually; it would also accept a connection() later in the file if requireAdmin is still the next await. My new guard asserts connection() is first in the admin route. No action needed.

No bugs sent back to the builder.
