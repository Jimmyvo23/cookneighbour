# Handoff: T-061 Tester

From: tester  To: reviewer

## Result: PASS (no product bugs found)
- PR #93, branch feature/T-061-rule-changes, tester commits 829d302 and df9d1b7 (tests only).
- Local: lint, typecheck, `npm test` pass (1264 passed, 3 expected fail). CI run 38091816411 green (API and RLS suites on local Supabase).

## Tests added
- `src/lib/domain/allergy-synonyms-tester.test.ts`: every pair in every SYNONYM_GROUP both ways (plural, in a sentence), D-24 words and D-30 extra words present, false positives out (fish/shellfish, egg/milk, sesame/soy, nutmeg/nuts, mustard/wheat, shrimp/clams, squash/nuts).
- `tests/api/admin-chefs-checks.test.ts`: rejected chef via route: kitchen review approve, reject and stale input all 409 INVALID_STATE, no row change, no new notification; pending chef kitchen reject then approve still works.
- `tests/api/admin-chefs-access.test.ts`: flagged for each of the four checks (police counts); rejected not flagged; failing a check by route keeps status approved, reset clears flag, exact item keys (no private data); checks=pending still ignores police.
- `tests/api/search.test.ts`: reject turns chef's home off, re-approve keeps it off in search and page (control before); chef's-home-only chef then has the same 404 as an unknown id (status, body, headers); D-25 byte-identical signature, page opens once enabled.

## Findings to report (decisions for Planner/Jimmy, not bugs)
- Coconut: not in any group; "coconut" does NOT match "tree nuts" either way.
- Buckwheat: "buckwheat" does NOT match "wheat" or "gluten" (and wheat does not match buckwheat). Both are pinned in a test labelled as current behaviour.
- Peanut and tree nut are one group (over-warns by design, D-24/handoff).
- Drift guard: old T-035 migration untouched; new bodies equal old except the two intended lines; grants service_role only.
- Test-input notes: DB refuses an empty location_options (23514), so D-25 is covered with chef's-home-only not enabled. Kitchen note has a minimum length (422).
- Not covered by design: D-31 (search avoidAllergens) is T-042.
