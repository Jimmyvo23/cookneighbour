# T-032 Reviewer handoff

**Task:** T-032 Dishes and availability API (PR #75)
**Verdict:** APPROVE on head 4def5dd (review comment 6063871135; CI run 37804276940 green)
**Written by:** Planner, from the Reviewer's report (D-7)

## What was checked
- Security: routes are the only writers (client writes revoked, six write policies dropped, read policies kept). Role from `profiles.role`. Storage path ownership enforced (403 for another chef's folder). Conditional updates.
- Migration `20261009120000_dishes_availability_routes_only.sql`: safe on hosted data; 50-active-dish cap trigger with per-chef advisory lock, empty `search_path`, EXECUTE revoked.
- Races: cap enforced in the database; parallel-create tests at DB and API level.
- Privacy: pending/rejected chefs' dishes and dates hidden; approved chefs show only active dishes. Tested.
- Contract v1.1 (sections 5A, 5B) matches the code and cites D-15 and D-16.
- Scope matches the WO-3 T-032 row. Nothing here needs a MOCK label.

## Findings
1. LOW: `docs/api-contract.md:175` says 422 before 404/409. The code checks ownership first (404, and 403 for a foreign photo path) before 422. Code is right; fix the sentence at the next contract touch.
2. INFO: `src/lib/domain/dishes.ts:6` still calls the limits "ASSUMPTIONS" (decided by D-16).
3. INFO: migration line 16 also says "ASSUMPTION"; leave it once `db push` has run.
4. INFO, accepted: PUT availability is two statements, not one transaction; replaced dish photos stay in Storage; a chef can delete their own photo between check and save; clearing a booked date does not change the booking.

## Follow-ups
- Planner: merge, `npx supabase db push`, record D-15/D-16 and these notes in PLAN.md.
- T-034: mock adapter dish/availability routes; dish photos with a fresh lower-case uuid; expect 404 before 422, 403 foreign path, 409 at cap; use server `today`/`lastBookableDay`; missing-photo fallback; labelled fields and focus to errors.
- WO-4: booking requires an available date and a double-booking check; rule for clearing a booked date; customer read routes; compare allergens in lower case.
