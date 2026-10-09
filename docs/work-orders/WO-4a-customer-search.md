# Work Order WO-4a: Phase 4 (part 1) — Domain rules, free trial, search and chef detail

Tasks: T-037, T-038, T-039, T-040, T-041
Approval: pre-approved by Jimmy on 2026-10-07 (WO-3 to WO-6, D-13). Quality over speed: every task goes Builder → Tester → Reviewer.
Split: PLAN §4 says Phase 4 "may split into two". WO-4a covers rules, search and chef detail. WO-4b (T-042 to T-045: booking API and flow, grocery options, chef booking dashboard) follows, after Jimmy answers the booking questions listed below.

| Agent | Task | Plan (100 words or fewer) | Effort (S/M/L) | Risk |
|---|---|---|---|---|
| backend | T-037 Domain rules (TDD) | Pure functions in `src/lib/domain/`, test-first: estimate (cook time sum, labour = time × rate, ingredients, travel fee only for customer's home, platform fee shown not collected), 6-hour soft limit per visit, booking validation (1–3 days, no past date, inside the D-15 window, chef available, double booking, service area for customer's home, chef's home only if `approved` AND `chef_home_enabled`), allergy conflict (lower-case compare), receipt mismatch, cancellation timing (A-6), eat-by (A-7). Constants from A-8 in one config module. Receipt tolerance A-15; travel and platform fee A-13, A-14; free-trial outcomes A-16 as a pure rule. Also: `allergenList` counts duplicates after merging (T-034 backlog); tighten phone (invalid NANP codes, N11) and postal-letter rules (T-028 follow-up, §10 malformed phone and non-GTA postal code). | M | Rounding errors in money; integer cents only, property tests |
| backend | T-038 Free-trial rules | Eligibility by verified phone hash and address hash, hold / consume / release state machine on `free_trial_claims` (A-16: decline, expiry, chef no-show and cancel-before-visit release; completed or customer no-show consumes). Pure rules plus server functions that use the existing unique indexes atomically. No booking routes yet (T-042). | M | Race on two holds; enforced by unique indexes and a conditional write, tested in parallel |
| backend | T-039 Search API | Public routes (contract §7, extended to v1.3, replacing the §7 rating sort with distance sort and keeping its MUST rules: `.eq('status','approved')`, one 404 for unknown, pending and rejected): `GET /api/chefs` with location (city or postal prefix, A-18), cuisine, language, dietary (A-17), price range and date filters, distance sort (A-1), rating, rate, cuisines, A-20 completeness; `GET /api/chefs/:id` with active dishes and bookable dates (A-19); `GET /api/reference/postal-prefixes` for the city picker. Chef's home shown or matched only when `approved` AND `chef_home_enabled`. Anon-capable client, no service role. Also: `await connection()` in the admin list GET (T-036 backlog). | M | Leaking pending chefs; explicit status filter plus RLS tests |
| frontend | T-040 Search and results UI with map | Search form (city or postal code, cuisine, optional language, dietary, price, date), results sorted by distance with rating, rate and cuisines, Leaflet + OpenStreetMap map. Mobile first, keyboard accessible, list stays usable without the map. Mock adapter routes. Also: T-036 backlog (admin `reload()` superseded state; "Signed up" label). | M | Map accessibility; list is the primary view |
| frontend | T-041 Chef detail page | Public chef page: photo, bio, cuisines, languages, rate, location options, active dishes with photos and allergens, bookable dates (A-19); chef's home shown only when `approved` AND `chef_home_enabled`; "Book" entry point stub until WO-4b. No private data (no address, phone, kitchen photos). | S | Private data on a public page; server reads only through the public route |
| tester | Verify every WO-4a PR | Unit and property tests for money and dates, API tests, RLS tests, axe and keyboard checks, mock and real-route e2e. §10 cases in WO-4a: pending or rejected chefs never in search; non-GTA or malformed postal code; malformed phone; more than 3 days; past date; over 6 hours; double booking; outside service area; chef's home not offered; allergy conflict; receipt mismatch (domain); second free trial by same phone or address, including the parallel race. | M | None notable |
| reviewer | Review every WO-4a PR | Security, privacy, MOCK honesty, contract match, accessibility, plan compliance. | M | None notable |

Order: T-037 → T-039 → T-038 (backend, one at a time). Frontend starts T-040 once the T-039 contract (v1.3) is merged, then T-041. Backend and frontend tasks may run in parallel in separate worktrees when their dependencies are met.

## Status rule (D-17)
Before starting any agent, the Planner records its status with `--task` and `--progress 0`. Every prompt tells the agent to report `--task` and `--progress` at 25, 50, 75 and 100.

## Open questions for Jimmy (needed before WO-4b, not before WO-4a)
- Q-8 Cancellation timing (A-6 placeholder: free until 48 hours before day 1).
- Q-9 Payment step: pure MOCK (A-10, Planner's recommendation) or Stripe test mode.
- Q-11 How long a `requested` booking holds a chef's date before it expires.
- Q-16 Admin MOCK-check rules (a)–(d).
- Q-13 May an approved chef clear their bio or photo and stay listed? Interim A-20 hides them from search (affects WO-4a).
- Q-18 Diets beyond allergens (A-17 until decided).
- Q-17 (new) What happens to a booking when the chef clears that date, or when an approved chef is rejected? Planner suggests: a chef cannot clear a date with an active booking (409); rejecting a chef cancels their future `requested` bookings and flags `accepted` ones for the admin.

Constants from A-8 (fees, radius) stay placeholders and configurable (Q-5). New assumptions A-13 to A-20 (PLAN §2) define rules CLAUDE.md leaves open; Jimmy may change any of them.

## Recommendation
Approve (pre-approved). Search and rules first, so WO-4b can start as soon as the booking questions are answered.

## Left out
Booking routes and flow, grocery options, chef booking dashboard (WO-4b). WO-4b must also carry: booking requires a verified phone, checked on the server (T-057); tell chefs the kitchen address is shared once a chef's-home booking is accepted, and keep removed kitchen photos hidden from customers (T-033); kitchen-address change during an accepted chef's-home booking (contract §11 N3); subtract booked dates from bookable dates (A-19). T-031 R1 (kitchen-photo re-register race) goes to the T-051 edge-case sweep. Messaging, reviews, reports (WO-5). Bidi characters (T-060). Hosted seed data (needs Jimmy). Deploy (WO-7).

## Decision
Pre-approved by Jimmy 2026-10-07 (D-13). Recorded as `WO-4a-backend`, `WO-4a-frontend`, `WO-4a-tester`, `WO-4a-reviewer`.
